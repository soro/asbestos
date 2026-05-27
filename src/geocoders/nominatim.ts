import { GeocodeCoordinates, GeocoderProvider } from "./types";

const DEFAULT_NOMINATIM_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_USER_AGENT = "asbestos-projects-nys/0.1 (mailto:soeren@roerden.de)";
const DEFAULT_REQUEST_DELAY_MS = 1100;
const NY_STATE_BOUNDS = {
    minLat: 40.3,
    maxLat: 45.2,
    minLng: -80.0,
    maxLng: -71.7,
};

interface NominatimResult {
    lat?: string;
    lon?: string;
    display_name?: string;
    address?: {
        country_code?: string;
        state?: string;
        state_code?: string;
    };
}

function normalizeQuery(value: string): string {
    return value
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\s+,/g, ",")
        .replace(/,\s+/g, ", ")
        .trim();
}

function withoutZipCode(value: string): string {
    return value.replace(/,\s*\d{5}(?:-\d{4})?\s*,\s*NY$/i, ", NY");
}

function buildQueryVariants(address: string): string[] {
    const normalizedAddress = normalizeQuery(address);
    const variants = [
        normalizedAddress,
        withoutZipCode(normalizedAddress),
    ].filter((value) => value.length > 0);

    return variants.filter((value, index) => variants.indexOf(value) === index);
}

function parseRequestDelayMs(): number {
    const value = Number(process.env.NOMINATIM_REQUEST_DELAY_MS);
    if (Number.isFinite(value) && value >= DEFAULT_REQUEST_DELAY_MS) {
        return value;
    }

    return DEFAULT_REQUEST_DELAY_MS;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsideNewYorkBounds(lat: number, lng: number): boolean {
    return lat >= NY_STATE_BOUNDS.minLat &&
        lat <= NY_STATE_BOUNDS.maxLat &&
        lng >= NY_STATE_BOUNDS.minLng &&
        lng <= NY_STATE_BOUNDS.maxLng;
}

function isNewYorkResult(result: NominatimResult, lat: number, lng: number): boolean {
    if (!isInsideNewYorkBounds(lat, lng)) {
        return false;
    }

    const countryCode = result.address?.country_code?.toLowerCase();
    if (countryCode && countryCode !== "us") {
        return false;
    }

    const state = result.address?.state?.toLowerCase();
    const stateCode = result.address?.state_code?.toLowerCase();
    if (state === "new york" || stateCode === "ny") {
        return true;
    }

    return /\bnew york\b/i.test(result.display_name ?? "");
}

function toCoordinates(result: NominatimResult): GeocodeCoordinates | null {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    if (!isNewYorkResult(result, lat, lng)) {
        return null;
    }

    return { lat, lng };
}

export function createNominatimGeocoder(): GeocoderProvider {
    const serviceUrl = process.env.NOMINATIM_GEOCODER_URL ?? DEFAULT_NOMINATIM_GEOCODER_URL;
    const userAgent = process.env.NOMINATIM_USER_AGENT ?? DEFAULT_USER_AGENT;
    const requestDelayMs = parseRequestDelayMs();

    return {
        name: "nominatim",
        requestDelayMs,
        async geocode(address: string): Promise<GeocodeCoordinates | null> {
            const queryVariants = buildQueryVariants(address);

            for (let index = 0; index < queryVariants.length; index += 1) {
                if (index > 0) {
                    await wait(requestDelayMs);
                }

                const url = new URL(serviceUrl);
                url.searchParams.set("q", queryVariants[index]);
                url.searchParams.set("format", "jsonv2");
                url.searchParams.set("limit", "3");
                url.searchParams.set("countrycodes", "us");
                url.searchParams.set("addressdetails", "1");
                url.searchParams.set("dedupe", "1");

                try {
                    const response = await fetch(url, {
                        headers: {
                            "Accept": "application/json",
                            "Accept-Language": "en",
                            "User-Agent": userAgent,
                        },
                    });

                    if (!response.ok) {
                        if (response.status === 400) {
                            continue;
                        }

                        throw new Error(`HTTP ${response.status}`);
                    }

                    const results = await response.json() as NominatimResult[];
                    for (const result of results) {
                        const coords = toCoordinates(result);
                        if (coords) {
                            return coords;
                        }
                    }
                } catch (error) {
                    console.error(`Nominatim geocoding error for ${address}:`, error);
                    throw error;
                }
            }

            return null;
        },
    };
}
