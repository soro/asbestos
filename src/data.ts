import { GeocodedResult, SearchResult } from "./types";

function normalizeWhitespace(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

function normalizeIdentityPart(value: string): string {
    return normalizeWhitespace(value).toUpperCase();
}

export function getSiteKey(site: SearchResult): string {
    return [
        site.contractor,
        site.start,
        site.end,
        site.street,
        site.city,
        site.zip,
        site.caseReference ?? "",
    ].map(normalizeIdentityPart).join("|");
}

export function buildAddressQuery(site: SearchResult): string {
    return [
        site.street,
        site.city,
        site.zip,
        "NY",
    ].map(normalizeWhitespace).join(", ");
}

export function dedupeSites<T extends SearchResult>(sites: T[]): T[] {
    const uniqueSites = new Map<string, T>();

    for (const site of sites) {
        const key = getSiteKey(site);
        if (!uniqueSites.has(key)) {
            uniqueSites.set(key, site);
        }
    }

    return Array.from(uniqueSites.values());
}

export function hasCoordinates(site: GeocodedResult): site is GeocodedResult & { lat: number; lng: number } {
    return typeof site.lat === "number" &&
        Number.isFinite(site.lat) &&
        typeof site.lng === "number" &&
        Number.isFinite(site.lng);
}

export function formatProjectDate(value: string): string {
    return value.split("T")[0] || value;
}
