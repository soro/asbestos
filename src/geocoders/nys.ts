import { GeocodeCoordinates, GeocoderProvider } from "./types";

const DEFAULT_NYS_GEOCODER_URL = "https://nysgeohub.ny.gov/arcgis/rest/services/Geocoder/NYS_Geocoder/GeocodeServer";
const REQUEST_DELAY_MS = 100;

interface NysGeocoderError {
    code?: number;
    message?: string;
}

interface NysGeocoderResponse {
    error?: NysGeocoderError;
    candidates?: Array<{
        location?: {
            x?: number;
            y?: number;
        };
    }>;
}

export function createNysGeocoder(): GeocoderProvider {
    const serviceUrl = (process.env.NYS_GEOCODER_URL ?? DEFAULT_NYS_GEOCODER_URL).replace(/\/+$/, "");

    return {
        name: "nys",
        requestDelayMs: REQUEST_DELAY_MS,
        async geocode(address: string): Promise<GeocodeCoordinates | null> {
            const url = new URL(`${serviceUrl}/findAddressCandidates`);
            url.searchParams.set("SingleLine", address);
            url.searchParams.set("maxLocations", "1");
            url.searchParams.set("outSR", "4326");
            url.searchParams.set("outFields", "*");
            url.searchParams.set("f", "pjson");

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json() as NysGeocoderResponse;
                if (data.error) {
                    throw new Error(data.error.message ?? "Unknown NYS geocoding error");
                }

                const location = data.candidates?.[0]?.location;
                if (typeof location?.y !== "number" || typeof location?.x !== "number") {
                    return null;
                }

                return {
                    lat: location.y,
                    lng: location.x,
                };
            } catch (error) {
                console.error(`NYS geocoding error for ${address}:`, error);
                throw error;
            }
        },
    };
}
