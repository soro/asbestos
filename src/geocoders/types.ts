export const GEOCODER_PROVIDER_NAMES = ["census", "nys"] as const;

export type GeocoderProviderName = typeof GEOCODER_PROVIDER_NAMES[number];

export interface GeocodeCoordinates {
    lat: number;
    lng: number;
}

export interface GeocoderProvider {
    readonly name: GeocoderProviderName;
    readonly requestDelayMs: number;
    geocode(address: string): Promise<GeocodeCoordinates | null>;
}

export function isGeocoderProviderName(value: string): value is GeocoderProviderName {
    return (GEOCODER_PROVIDER_NAMES as readonly string[]).includes(value);
}
