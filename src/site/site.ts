import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { BASEMAP_BOUNDS, BASEMAP_FILENAME } from "../basemap";
import { formatProjectDate, hasCoordinates } from "../data";
import { GeocodedResult } from "../types";

const MAX_SEARCH_RESULTS = 10;
const PROJECT_SOURCE_ID = "asbestos-projects";
const PROJECT_LAYER_ID = "projects-circles";

type BasemapMode = "pmtiles" | "raster";
type MappedSite = GeocodedResult & { lat: number; lng: number };

type ProjectFeatureProperties = {
    contractor: string;
    street: string;
    city: string;
    zip: string;
    start: string;
    end: string;
    caseReference?: string;
};

const CONFIG = {
    pmtilesUrl: BASEMAP_FILENAME,
    filterToNYC: true,
    nycBounds: BASEMAP_BOUNDS,
};

const pmtilesProtocol = new Protocol();
let hasRegisteredPmtilesProtocol = false;
let hasRegisteredRasterServiceWorker = false;

export async function getAllSites(): Promise<GeocodedResult[]> {
    const response = await fetch("output.json");
    if (!response.ok) {
        throw new Error(`Failed to load project data (${response.status})`);
    }

    return response.json() as Promise<GeocodedResult[]>;
}

function createPopupContent(site: ProjectFeatureProperties): HTMLElement {
    const container = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = site.contractor;
    title.style.display = "block";

    const address = document.createElement("div");
    address.textContent = `${site.street}, ${site.city}, ${site.zip}`;

    const schedule = document.createElement("div");
    schedule.textContent = `Start: ${formatProjectDate(site.start)} End: ${formatProjectDate(site.end)}`;

    container.append(title, address, schedule);

    if (site.caseReference) {
        const caseReference = document.createElement("div");
        caseReference.textContent = `Case: ${site.caseReference}`;
        container.appendChild(caseReference);
    }

    return container;
}

function registerPmtilesProtocol(): void {
    if (!hasRegisteredPmtilesProtocol) {
        maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
        hasRegisteredPmtilesProtocol = true;
    }
}

function getMapStyle(mode: BasemapMode): maplibregl.StyleSpecification {
    if (mode === "pmtiles") {
        registerPmtilesProtocol();

        return {
            version: 8,
            glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
            sources: {
                protomaps: {
                    type: "vector",
                    url: `pmtiles://${CONFIG.pmtilesUrl}`,
                    attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
                },
            },
            layers: [
                {
                    id: "background",
                    type: "background",
                    paint: { "background-color": "#e0e0e0" },
                },
                {
                    id: "water",
                    type: "fill",
                    source: "protomaps",
                    "source-layer": "water",
                    paint: { "fill-color": "#a0c8f0" },
                },
                {
                    id: "roads",
                    type: "line",
                    source: "protomaps",
                    "source-layer": "roads",
                    paint: { "line-color": "#ffffff", "line-width": 1 },
                },
                {
                    id: "road_labels",
                    type: "symbol",
                    source: "protomaps",
                    "source-layer": "roads",
                    minzoom: 12,
                    layout: {
                        "symbol-placement": "line",
                        "text-field": ["get", "name"],
                        "text-size": 12,
                        "text-font": ["Noto Sans Regular"],
                    },
                    paint: {
                        "text-color": "#666",
                        "text-halo-color": "#fff",
                        "text-halo-width": 2,
                    },
                },
                {
                    id: "buildings",
                    type: "fill",
                    source: "protomaps",
                    "source-layer": "buildings",
                    paint: { "fill-color": "#d0d0d0" },
                },
                {
                    id: "places",
                    type: "symbol",
                    source: "protomaps",
                    "source-layer": "places",
                    layout: {
                        "text-field": ["get", "name"],
                        "text-size": 12,
                        "text-font": ["Noto Sans Regular"],
                    },
                    paint: {
                        "text-color": "#444",
                        "text-halo-color": "#fff",
                        "text-halo-width": 2,
                    },
                },
            ],
        };
    }

    return {
        version: 8,
        sources: {
            osm: {
                type: "raster",
                tiles: [
                    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
                ],
                tileSize: 256,
                attribution: "&copy; OpenStreetMap Contributors",
            },
        },
        layers: [
            {
                id: "osm-tiles",
                type: "raster",
                source: "osm",
                minzoom: 0,
                maxzoom: 19,
            },
        ],
    };
}

function getGeoJson(sites: MappedSite[]): GeoJSON.FeatureCollection<GeoJSON.Point, ProjectFeatureProperties> {
    return {
        type: "FeatureCollection",
        features: sites.map((site) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [site.lng, site.lat],
            },
            properties: {
                contractor: site.contractor,
                street: site.street,
                city: site.city,
                zip: site.zip,
                start: site.start,
                end: site.end,
                caseReference: site.caseReference,
            },
        })),
    };
}

function setProjectData(map: maplibregl.Map, sites: MappedSite[]): void {
    const source = map.getSource(PROJECT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
        source.setData(getGeoJson(sites));
    }
}

function focusOnSite(map: maplibregl.Map, site: MappedSite): void {
    map.flyTo({
        center: [site.lng, site.lat],
        zoom: 15,
    });

    new maplibregl.Popup()
        .setLngLat([site.lng, site.lat])
        .setDOMContent(createPopupContent(site))
        .addTo(map);
}

function renderSearchResults(
    container: HTMLElement,
    sites: MappedSite[],
    onSelect: (site: MappedSite) => void,
): void {
    container.replaceChildren();

    const visibleResults = sites.slice(0, MAX_SEARCH_RESULTS);
    for (const site of visibleResults) {
        const result = document.createElement("div");
        result.className = "result-item";

        const title = document.createElement("strong");
        title.textContent = site.contractor;
        result.append(title, document.createTextNode(`${site.street}, ${site.city}`));

        result.addEventListener("click", () => {
            onSelect(site);
        });

        container.appendChild(result);
    }

    container.style.display = visibleResults.length > 0 ? "block" : "none";
}

function isPmtilesSourceError(event: unknown): boolean {
    if (typeof event !== "object" || event === null) {
        return false;
    }

    const candidate = event as {
        sourceId?: unknown;
        error?: { message?: unknown } | string;
    };

    if (candidate.sourceId === "protomaps") {
        return true;
    }

    const errorMessage = typeof candidate.error === "string"
        ? candidate.error
        : typeof candidate.error?.message === "string"
            ? candidate.error.message
            : "";

    return /pmtiles|range|network|fetch|request/i.test(errorMessage);
}

async function ensureRasterServiceWorker(): Promise<void> {
    if (hasRegisteredRasterServiceWorker || !("serviceWorker" in navigator)) {
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register("sw.js");
        hasRegisteredRasterServiceWorker = true;
        console.log("ServiceWorker registration successful with scope:", registration.scope);
    } catch (error) {
        console.log("ServiceWorker registration failed:", error);
    }
}

export async function initMap(): Promise<void> {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    const searchClear = document.getElementById("search-clear") as HTMLButtonElement | null;
    const searchResults = document.getElementById("search-results");

    let map: maplibregl.Map | null = null;
    let allSites: MappedSite[] = [];
    let visibleSites: MappedSite[] = [];
    let currentBasemapMode: BasemapMode = "pmtiles";
    let isSwitchingBasemap = false;

    function fitBoundsToSites(sites: MappedSite[]): void {
        if (!map) {
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        for (const site of sites) {
            bounds.extend([site.lng, site.lat]);
        }

        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 50 });
        }
    }

    function syncSearchControls(query: string): void {
        if (searchClear) {
            searchClear.hidden = query.length === 0;
        }

        if (searchInput) {
            searchInput.setAttribute("aria-expanded", searchResults?.style.display === "block" ? "true" : "false");
        }
    }

    function clearSearch(): void {
        if (!searchInput) {
            return;
        }

        searchInput.value = "";
        applySearch("");
        searchInput.focus();
    }

    function applySearch(query: string): void {
        if (!searchResults) {
            return;
        }

        if (!query) {
            visibleSites = allSites;
            searchResults.style.display = "none";
            searchResults.replaceChildren();
            if (map) {
                setProjectData(map, visibleSites);
            }
            syncSearchControls(query);
            return;
        }

        visibleSites = allSites.filter((site) =>
            site.contractor.toLowerCase().includes(query) ||
            site.city.toLowerCase().includes(query) ||
            site.street.toLowerCase().includes(query) ||
            site.zip.includes(query),
        );

        if (map) {
            setProjectData(map, visibleSites);
        }

        renderSearchResults(searchResults, visibleSites, (site) => {
            if (!map || !searchInput) {
                return;
            }

            searchInput.value = site.contractor;
            searchResults.style.display = "none";
            visibleSites = [site];
            setProjectData(map, visibleSites);
            focusOnSite(map, site);
        });
        syncSearchControls(query);

        if (visibleSites.length === 1 && map) {
            focusOnSite(map, visibleSites[0]);
        }
    }

    async function renderMap(): Promise<void> {
        if (map) {
            map.remove();
            map = null;
        }

        if (currentBasemapMode === "raster") {
            await ensureRasterServiceWorker();
        }

        map = new maplibregl.Map({
            container: "map",
            style: getMapStyle(currentBasemapMode),
            center: [-74.0, 40.7],
            zoom: 10,
        });

        map.on("error", (event) => {
            if (isSwitchingBasemap || currentBasemapMode !== "pmtiles" || !isPmtilesSourceError(event)) {
                return;
            }

            isSwitchingBasemap = true;
            currentBasemapMode = "raster";
            console.warn("PMTiles failed to load, falling back to raster tiles.", event);

            void renderMap().finally(() => {
                isSwitchingBasemap = false;
            });
        });

        map.on("load", () => {
            if (!map) {
                return;
            }

            const loadedMap = map;

            loadedMap.addSource(PROJECT_SOURCE_ID, {
                type: "geojson",
                data: getGeoJson(visibleSites),
            });

            loadedMap.addLayer({
                id: PROJECT_LAYER_ID,
                type: "circle",
                source: PROJECT_SOURCE_ID,
                paint: {
                    "circle-color": "#ff0000",
                    "circle-radius": 6,
                    "circle-stroke-width": 1,
                    "circle-stroke-color": "#fff",
                },
            });

            loadedMap.on("click", PROJECT_LAYER_ID, (event) => {
                const feature = event.features?.[0];
                if (!feature || feature.geometry.type !== "Point") {
                    return;
                }

                const coordinates = [...feature.geometry.coordinates] as [number, number];
                const properties = feature.properties as ProjectFeatureProperties | undefined;
                if (!properties) {
                    return;
                }

                new maplibregl.Popup()
                    .setLngLat(coordinates)
                    .setDOMContent(createPopupContent(properties))
                    .addTo(loadedMap);
            });

            loadedMap.on("mouseenter", PROJECT_LAYER_ID, () => {
                loadedMap.getCanvas().style.setProperty("cursor", "pointer");
            });

            loadedMap.on("mouseleave", PROJECT_LAYER_ID, () => {
                loadedMap.getCanvas().style.setProperty("cursor", "");
            });

            fitBoundsToSites(visibleSites);
        });
    }

    syncSearchControls("");

    try {
        const loadedSites = await getAllSites();
        allSites = loadedSites.filter(hasCoordinates);

        if (CONFIG.filterToNYC) {
            const bounds = CONFIG.nycBounds;
            allSites = allSites.filter((site) =>
                site.lng >= bounds.minLng &&
                site.lng <= bounds.maxLng &&
                site.lat >= bounds.minLat &&
                site.lat <= bounds.maxLat,
            );
        }

        visibleSites = allSites;

        if (searchInput && searchResults) {
            searchInput.addEventListener("input", (event) => {
                applySearch((event.target as HTMLInputElement).value.trim().toLowerCase());
            });

            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && searchInput.value) {
                    event.preventDefault();
                    clearSearch();
                }
            });

            document.addEventListener("click", (event) => {
                const target = event.target;
                if (target instanceof Node &&
                    !searchInput.contains(target) &&
                    !searchResults.contains(target)) {
                    searchResults.style.display = "none";
                    syncSearchControls(searchInput.value.trim().toLowerCase());
                }
            });
        }

        searchClear?.addEventListener("click", () => {
            clearSearch();
        });

        await renderMap();
    } catch (error) {
        console.error("Failed to initialize map data:", error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    void initMap();
});
