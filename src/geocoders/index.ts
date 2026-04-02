import { createCensusGeocoder } from "./census";
import { createNysGeocoder } from "./nys";
import { GeocoderProvider, GeocoderProviderName, isGeocoderProviderName } from "./types";

const DEFAULT_PROVIDER_ORDER: GeocoderProviderName[] = ["census"];

const PROVIDER_FACTORIES: Record<GeocoderProviderName, () => GeocoderProvider> = {
    census: createCensusGeocoder,
    nys: createNysGeocoder,
};

function parseProviderOrder(rawValue: string): GeocoderProviderName[] {
    const parsedNames = rawValue.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is string => value.length > 0);

    const invalidNames = parsedNames.filter((value) => !isGeocoderProviderName(value));
    if (invalidNames.length > 0) {
        throw new Error(`Unsupported geocoder provider(s): ${invalidNames.join(", ")}`);
    }

    const uniqueNames = parsedNames.filter((value, index) => parsedNames.indexOf(value) === index) as GeocoderProviderName[];
    if (uniqueNames.length === 0) {
        throw new Error("GEOCODER_PROVIDER_ORDER did not contain any geocoder providers.");
    }

    return uniqueNames;
}

export function getConfiguredGeocoders(): GeocoderProvider[] {
    const rawProviderOrder = process.env.GEOCODER_PROVIDER_ORDER ?? DEFAULT_PROVIDER_ORDER.join(",");
    const providerOrder = parseProviderOrder(rawProviderOrder);

    return providerOrder.map((providerName) => PROVIDER_FACTORIES[providerName]());
}
