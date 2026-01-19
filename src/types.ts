export interface SearchResult {
    contractor: string;
    start: string;
    end: string;
    street: string;
    zip: string;
    city: string;
    county?: string;
}

export interface GeocodedResult extends SearchResult {
    lat?: number;
    lng?: number;
}