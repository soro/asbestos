export const BASEMAP_FILENAME = "new-york.pmtiles.gz";
export const BASEMAP_MAX_ZOOM = 14;
export const BASEMAP_TARGET_MAX_BYTES = 50_000_000;

export const BASEMAP_BOUNDS = {
    minLng: -74.3,
    minLat: 40.49,
    maxLng: -73.6,
    maxLat: 41.0,
};

export function getBasemapBoundingBox(): string {
    return [
        BASEMAP_BOUNDS.minLng,
        BASEMAP_BOUNDS.minLat,
        BASEMAP_BOUNDS.maxLng,
        BASEMAP_BOUNDS.maxLat,
    ].join(",");
}
