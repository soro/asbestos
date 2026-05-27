import { GeocodedResult, ProjectAddress, SearchResult } from "./types";

const PROJECT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

function normalizeWhitespace(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

function normalizeOrdinalStreetNumbers(value: string): string {
    return value.replace(/(\d+)(ST|ND|RD|TH)\b/g, "$1");
}

function normalizeIdentityPart(value: string): string {
    return normalizeWhitespace(value).toUpperCase();
}

export function dateKey(value: string): string {
    return value.trim().slice(0, 10);
}

export function normalizeContractorForMatch(value: string): string {
    return normalizeIdentityPart(value)
        .replace(/&/g, " AND ")
        .replace(/\b(CORPORATION|CORP|INCORPORATED|INC|LLC|L L C|LTD|LIMITED|CO|COMPANY)\b/g, "")
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function normalizeAddressForMatch(value: string): string {
    let normalizedValue = normalizeOrdinalStreetNumbers(normalizeIdentityPart(value));
    const replacements: Array<[RegExp, string]> = [
        [/\bEAST\b/g, "E"],
        [/\bWEST\b/g, "W"],
        [/\bNORTH\b/g, "N"],
        [/\bSOUTH\b/g, "S"],
        [/\bSTREET\b/g, "ST"],
        [/\bAVENUE\b/g, "AVE"],
        [/\bBOULEVARD\b/g, "BLVD"],
        [/\bROAD\b/g, "RD"],
        [/\bPLACE\b/g, "PL"],
        [/\bDRIVE\b/g, "DR"],
        [/\bLANE\b/g, "LN"],
        [/\bCOURT\b/g, "CT"],
        [/\bPARKWAY\b/g, "PKWY"],
        [/\bTERRACE\b/g, "TER"],
        [/\bHIGHWAY\b/g, "HWY"],
        [/\bEXPRESSWAY\b/g, "EXPY"],
        [/\bCIRCLE\b/g, "CIR"],
        [/\bSQUARE\b/g, "SQ"],
    ];

    for (const [pattern, replacement] of replacements) {
        normalizedValue = normalizedValue.replace(pattern, replacement);
    }

    return normalizedValue
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function getAddressKey(address: ProjectAddress): string {
    return [
        normalizeAddressForMatch(address.street),
        normalizeIdentityPart(address.borough ?? address.city),
        normalizeIdentityPart(address.zip),
    ].join("|");
}

export function getStrictProjectMatchKey(project: {
    contractor: string;
    start: string;
    end: string;
    address: ProjectAddress;
}): string {
    return [
        normalizeContractorForMatch(project.contractor),
        normalizeAddressForMatch(project.address.street),
        dateKey(project.start),
        dateKey(project.end),
    ].join("|");
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

export function buildProjectAddressQuery(address: ProjectAddress): string {
    return [
        address.street,
        address.city,
        address.zip,
        address.state,
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
    const trimmedValue = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmedValue);
    if (!match) {
        return trimmedValue || value;
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, monthIndex, day));

    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== monthIndex ||
        date.getUTCDate() !== day) {
        return trimmedValue;
    }

    return PROJECT_DATE_FORMATTER.format(date);
}
