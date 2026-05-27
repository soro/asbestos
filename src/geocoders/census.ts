import { GeocodeCoordinates, GeocoderProvider } from "./types";

const CENSUS_BENCHMARK = process.env.CENSUS_GEOCODER_BENCHMARK ?? "Public_AR_Current";
const REQUEST_DELAY_MS = 100;

export function createCensusGeocoder(): GeocoderProvider {
    return {
        name: "census",
        requestDelayMs: REQUEST_DELAY_MS,
        async geocode(address: string): Promise<GeocodeCoordinates | null> {
            const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
            url.searchParams.set("address", address);
            url.searchParams.set("benchmark", CENSUS_BENCHMARK);
            url.searchParams.set("format", "json");

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    if (response.status === 400) {
                        return null;
                    }

                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json() as {
                    result?: {
                        addressMatches?: Array<{
                            coordinates?: {
                                x?: number;
                                y?: number;
                            };
                        }>;
                    };
                };

                const match = data.result?.addressMatches?.[0];
                const coordinates = match?.coordinates;
                if (typeof coordinates?.y !== "number" || typeof coordinates?.x !== "number") {
                    return null;
                }

                return {
                    lat: coordinates.y,
                    lng: coordinates.x,
                };
            } catch (error) {
                console.error(`Census geocoding error for ${address}:`, error);
                throw error;
            }
        },
    };
}
