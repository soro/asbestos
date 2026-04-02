import * as fs from "fs";
import * as path from "path";
import { SearchResult, GeocodedResult } from "./types";
import { buildAddressQuery, hasCoordinates } from "./data";
import { getConfiguredGeocoders } from "./geocoders";
import { GeocodeCoordinates, GeocoderProvider, GeocoderProviderName, isGeocoderProviderName } from "./geocoders/types";

const RAW_OUTPUT = path.join(__dirname, "../raw_output.json");
const OUTPUT = path.join(__dirname, "../output.json");
const CACHE_FILE = path.join(__dirname, "../geocode_cache.json");

interface CachedGeocode extends GeocodeCoordinates {
    provider?: GeocoderProviderName;
}

interface GeocodeLookup {
    coords: CachedGeocode | null;
    fromCache: boolean;
    attemptedDelayMs: number;
}

function normalizeCacheEntry(value: unknown): CachedGeocode | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as {
        lat?: unknown;
        lng?: unknown;
        provider?: unknown;
    };

    if (typeof candidate.lat !== "number" || !Number.isFinite(candidate.lat)) {
        return null;
    }

    if (typeof candidate.lng !== "number" || !Number.isFinite(candidate.lng)) {
        return null;
    }

    const entry: CachedGeocode = {
        lat: candidate.lat,
        lng: candidate.lng,
    };

    if (typeof candidate.provider === "string" && isGeocoderProviderName(candidate.provider)) {
        entry.provider = candidate.provider;
    }

    return entry;
}

function loadCache(): Record<string, CachedGeocode> {
    if (!fs.existsSync(CACHE_FILE)) {
        return {};
    }

    try {
        const rawCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Record<string, unknown>;
        return Object.entries(rawCache).reduce<Record<string, CachedGeocode>>((normalizedCache, [address, entry]) => {
            const normalizedEntry = normalizeCacheEntry(entry);
            if (normalizedEntry) {
                normalizedCache[address] = normalizedEntry;
            }

            return normalizedCache;
        }, {});
    } catch (_error) {
        console.log("Error reading cache, starting fresh.");
        return {};
    }
}

let cache: Record<string, CachedGeocode> = loadCache();

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function seedCacheFromOutput(): void {
    if (!fs.existsSync(OUTPUT)) {
        return;
    }

    try {
        const existingOutput = JSON.parse(fs.readFileSync(OUTPUT, "utf8")) as GeocodedResult[];
        for (const item of existingOutput) {
            if (!hasCoordinates(item)) {
                continue;
            }

            const address = buildAddressQuery(item);
            if (!cache[address]) {
                cache[address] = {
                    lat: item.lat,
                    lng: item.lng,
                };
            }
        }
    } catch (error) {
        console.warn("Unable to seed geocode cache from output.json:", error);
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatProviderLabel(provider: GeocoderProviderName | undefined, fromCache: boolean): string {
    if (fromCache) {
        return provider ? `cache:${provider}` : "cache";
    }

    return provider ?? "unknown";
}

async function geocodeAddress(address: string, geocoders: GeocoderProvider[]): Promise<GeocodeLookup> {
    const cachedCoords = cache[address];
    if (cachedCoords) {
        return {
            coords: cachedCoords,
            fromCache: true,
            attemptedDelayMs: 0,
        };
    }

    let attemptedDelayMs = 0;

    for (const geocoder of geocoders) {
        attemptedDelayMs = Math.max(attemptedDelayMs, geocoder.requestDelayMs);
        const coords = await geocoder.geocode(address);
        if (!coords) {
            continue;
        }

        const result: CachedGeocode = {
            ...coords,
            provider: geocoder.name,
        };
        cache[address] = result;
        return {
            coords: result,
            fromCache: false,
            attemptedDelayMs,
        };
    }

    return {
        coords: null,
        fromCache: false,
        attemptedDelayMs,
    };
}

async function main(): Promise<void> {
    if (!fs.existsSync(RAW_OUTPUT)) {
        console.error("No raw output found. Run scraper first.");
        process.exit(1);
    }

    seedCacheFromOutput();
    const geocoders = getConfiguredGeocoders();

    const rawData: SearchResult[] = JSON.parse(fs.readFileSync(RAW_OUTPUT, "utf8"));
    const geocodedData: GeocodedResult[] = [];

    console.log(`Geocoding ${rawData.length} items...`);
    console.log(`Configured geocoder order: ${geocoders.map((geocoder) => geocoder.name).join(" -> ")}`);

    for (const item of rawData) {
        const address = buildAddressQuery(item);
        const lookup = await geocodeAddress(address, geocoders);

        if (lookup.coords) {
            console.log(`Geocoded [${formatProviderLabel(lookup.coords.provider, lookup.fromCache)}]: ${address}`);
            geocodedData.push({
                ...item,
                lat: lookup.coords.lat,
                lng: lookup.coords.lng,
            });
        } else {
            console.log(`Failed to geocode: ${address}`);
            // Keep it without coords? Map won't show it.
            // Let's keep it so we don't lose data.
            geocodedData.push(item);
        }

        if (!lookup.fromCache && lookup.attemptedDelayMs > 0) {
            await wait(lookup.attemptedDelayMs);
        }
    }

    saveCache();
    fs.writeFileSync(OUTPUT, JSON.stringify(geocodedData, null, 2));
    console.log(`Saved ${geocodedData.length} items to ${OUTPUT}`);
}

main();
