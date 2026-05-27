import * as fs from "fs";
import * as path from "path";
import { GeocodedResult, SearchResult } from "./types";
import { buildAddressQuery, hasCoordinates } from "./data";
import { getConfiguredGeocoders } from "./geocoders";
import { GeocodeCoordinates, GeocoderProvider, GeocoderProviderName, isGeocoderProviderName } from "./geocoders/types";

const OUTPUT = path.join(__dirname, "../output.json");
const CACHE_FILE = path.join(__dirname, "../geocode_cache.json");
const FAILURE_CACHE_FILE = path.join(__dirname, "../geocode_failure_cache.json");
const FAILURE_CACHE_VERSION = 1;

interface CachedGeocode extends GeocodeCoordinates {
    provider?: GeocoderProviderName;
}

interface GeocodeLookup {
    coords: CachedGeocode | null;
    fromCache: boolean;
    fromFailureCache: boolean;
    providerError: boolean;
    attemptedDelayMs: number;
}

interface CachedGeocodeFailure {
    providers: GeocoderProviderName[];
    failedAt: string;
    cacheVersion: number;
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

function saveCache(): void {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function normalizeFailureCacheEntry(value: unknown): CachedGeocodeFailure | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as {
        providers?: unknown;
        failedAt?: unknown;
        cacheVersion?: unknown;
    };

    if (!Array.isArray(candidate.providers) ||
        !candidate.providers.every((provider): provider is GeocoderProviderName => (
            typeof provider === "string" && isGeocoderProviderName(provider)
        ))) {
        return null;
    }

    if (typeof candidate.failedAt !== "string" || candidate.failedAt.trim().length === 0) {
        return null;
    }

    if (candidate.cacheVersion !== FAILURE_CACHE_VERSION) {
        return null;
    }

    return {
        providers: candidate.providers,
        failedAt: candidate.failedAt,
        cacheVersion: FAILURE_CACHE_VERSION,
    };
}

function loadFailureCache(): Record<string, CachedGeocodeFailure> {
    if (!fs.existsSync(FAILURE_CACHE_FILE)) {
        return {};
    }

    try {
        const rawCache = JSON.parse(fs.readFileSync(FAILURE_CACHE_FILE, "utf8")) as Record<string, unknown>;
        return Object.entries(rawCache).reduce<Record<string, CachedGeocodeFailure>>((normalizedCache, [address, entry]) => {
            const normalizedEntry = normalizeFailureCacheEntry(entry);
            if (normalizedEntry) {
                normalizedCache[address] = normalizedEntry;
            }

            return normalizedCache;
        }, {});
    } catch (_error) {
        console.log("Error reading failure cache, starting fresh.");
        return {};
    }
}

let failureCache: Record<string, CachedGeocodeFailure> = loadFailureCache();

function saveFailureCache(): void {
    fs.writeFileSync(FAILURE_CACHE_FILE, JSON.stringify(failureCache, null, 2));
}

export function saveGeocodeCaches(): void {
    saveCache();
    saveFailureCache();
}

export function seedCacheFromOutput(): void {
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

export async function geocodeAddress(address: string, geocoders: GeocoderProvider[]): Promise<GeocodeLookup> {
    const providerOrder = geocoders.map((geocoder) => geocoder.name);
    const cachedCoords = cache[address];
    if (cachedCoords) {
        return {
            coords: cachedCoords,
            fromCache: true,
            fromFailureCache: false,
            providerError: false,
            attemptedDelayMs: 0,
        };
    }

    const cachedFailure = failureCache[address];
    if (cachedFailure &&
        cachedFailure.cacheVersion === FAILURE_CACHE_VERSION &&
        cachedFailure.providers.length === providerOrder.length &&
        cachedFailure.providers.every((provider, index) => provider === providerOrder[index])) {
        return {
            coords: null,
            fromCache: false,
            fromFailureCache: true,
            providerError: false,
            attemptedDelayMs: 0,
        };
    }

    let attemptedDelayMs = 0;
    let hadProviderError = false;

    for (const geocoder of geocoders) {
        attemptedDelayMs = Math.max(attemptedDelayMs, geocoder.requestDelayMs);
        let coords: GeocodeCoordinates | null;
        try {
            coords = await geocoder.geocode(address);
        } catch (_error) {
            hadProviderError = true;
            continue;
        }

        if (!coords) {
            continue;
        }

        const result: CachedGeocode = {
            ...coords,
            provider: geocoder.name,
        };
        cache[address] = result;
        delete failureCache[address];
        return {
            coords: result,
            fromCache: false,
            fromFailureCache: false,
            providerError: false,
            attemptedDelayMs,
        };
    }

    if (!hadProviderError) {
        failureCache[address] = {
            providers: providerOrder,
            failedAt: new Date().toISOString(),
            cacheVersion: FAILURE_CACHE_VERSION,
        };
    }

    return {
        coords: null,
        fromCache: false,
        fromFailureCache: false,
        providerError: hadProviderError,
        attemptedDelayMs,
    };
}

export async function geocodeSites(rawData: SearchResult[]): Promise<GeocodedResult[]> {
    seedCacheFromOutput();
    const geocoders = getConfiguredGeocoders();
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
                geocodingProvider: lookup.coords.provider,
            });
        } else {
            const failureLabel = lookup.fromFailureCache ? " [failure-cache]" : lookup.providerError ? " [provider-error]" : "";
            console.log(`Failed to geocode${failureLabel}: ${address}`);
            geocodedData.push(item);
        }

        if (!lookup.fromCache && lookup.attemptedDelayMs > 0) {
            await wait(lookup.attemptedDelayMs);
        }
    }

    saveGeocodeCaches();
    return geocodedData;
}
