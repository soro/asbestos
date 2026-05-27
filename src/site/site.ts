import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { BASEMAP_BOUNDS, BASEMAP_FILENAME } from "../basemap";
import { formatProjectDate, hasCoordinates } from "../data";
import { GeocodedResult } from "../types";

const MAX_SEARCH_RESULTS = 10;
const PROJECT_SOURCE_ID = "asbestos-projects";
const PROJECT_CLUSTER_LAYER_ID = "project-clusters";
const PROJECT_CLUSTER_COUNT_LAYER_ID = "project-cluster-count";
const PROJECT_LAYER_ID = "projects-circles";
const SEARCH_RESULT_ID_PREFIX = "search-result";
const PROTOMAPS_GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const PROTOMAPS_GRAYSCALE_SPRITE_URL = "https://protomaps.github.io/basemaps-assets/sprites/v4/grayscale";

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
let activePopup: maplibregl.Popup | null = null;

export async function getAllSites(): Promise<GeocodedResult[]> {
    const response = await fetch("output.json");
    if (!response.ok) {
        throw new Error(`Failed to load project data (${response.status})`);
    }

    return response.json() as Promise<GeocodedResult[]>;
}

function createPopupContent(site: ProjectFeatureProperties): HTMLElement {
    const container = document.createElement("div");
    container.className = "project-popup";

    const title = document.createElement("div");
    title.className = "project-popup__title";
    title.textContent = site.contractor;

    const address = document.createElement("div");
    address.className = "project-popup__address";
    address.textContent = `${site.street}, ${site.city}, ${site.zip}`;

    const details = document.createElement("div");
    details.className = "project-popup__details";

    appendPopupDetail(details, "Start", formatProjectDate(site.start));
    appendPopupDetail(details, "End", formatProjectDate(site.end));

    if (site.caseReference) {
        appendPopupDetail(details, "Case", site.caseReference);
    }

    container.append(title, address, details);

    return container;
}

function appendPopupDetail(details: HTMLDivElement, label: string, value: string): void {
    const row = document.createElement("div");
    row.className = "project-popup__detail";

    const labelElement = document.createElement("span");
    labelElement.className = "project-popup__label";
    labelElement.textContent = label;

    const valueElement = document.createElement("span");
    valueElement.className = "project-popup__value";
    valueElement.textContent = value;

    row.append(labelElement, valueElement);
    details.appendChild(row);
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
            glyphs: PROTOMAPS_GLYPHS_URL,
            sprite: PROTOMAPS_GRAYSCALE_SPRITE_URL,
            sources: {
                protomaps: {
                    type: "vector",
                    url: `pmtiles://${CONFIG.pmtilesUrl}`,
                    attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
                },
            },
            layers: protomapsLayers("protomaps", namedFlavor("grayscale"), { lang: "en" }),
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

    openProjectPopup(map, [site.lng, site.lat], site);
}

function openProjectPopup(
    map: maplibregl.Map,
    coordinates: [number, number],
    site: ProjectFeatureProperties,
): void {
    closeActivePopup();

    const popup = new maplibregl.Popup({ maxWidth: "360px" })
        .setLngLat(coordinates)
        .setDOMContent(createPopupContent(site))
        .addTo(map);

    activePopup = popup;
    popup.on("close", () => {
        if (activePopup === popup) {
            activePopup = null;
        }
    });
}

function closeActivePopup(): boolean {
    if (!activePopup) {
        return false;
    }

    activePopup.remove();
    activePopup = null;
    return true;
}

function renderSearchResults(
    container: HTMLElement,
    sites: MappedSite[],
    activeIndex: number,
    onSelect: (site: MappedSite) => void,
): number {
    container.replaceChildren();

    const visibleResults = sites.slice(0, MAX_SEARCH_RESULTS);
    for (const [index, site] of visibleResults.entries()) {
        const result = document.createElement("div");
        result.className = "result-item";
        result.id = `${SEARCH_RESULT_ID_PREFIX}-${index}`;
        result.setAttribute("role", "option");
        result.setAttribute("aria-selected", index === activeIndex ? "true" : "false");

        if (index === activeIndex) {
            result.classList.add("is-active");
        }

        const title = document.createElement("strong");
        title.className = "result-title";
        title.textContent = site.contractor;

        const address = document.createElement("span");
        address.className = "result-address";
        address.textContent = `${site.street}, ${site.city} ${site.zip}`;

        result.append(title, address);

        result.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
        result.addEventListener("click", () => {
            onSelect(site);
        });

        container.appendChild(result);
    }

    container.hidden = visibleResults.length === 0;
    return visibleResults.length;
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
    const searchContainer = document.querySelector(".search-container");

    let map: maplibregl.Map | null = null;
    let allSites: MappedSite[] = [];
    let visibleSites: MappedSite[] = [];
    let currentBasemapMode: BasemapMode = "pmtiles";
    let isSwitchingBasemap = false;
    let activeSearchIndex = -1;
    let renderedSearchCount = 0;

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
            const resultsAreOpen = Boolean(searchResults && !searchResults.hidden);
            searchInput.setAttribute("aria-expanded", resultsAreOpen ? "true" : "false");

            if (resultsAreOpen && activeSearchIndex >= 0) {
                searchInput.setAttribute("aria-activedescendant", `${SEARCH_RESULT_ID_PREFIX}-${activeSearchIndex}`);
            } else {
                searchInput.removeAttribute("aria-activedescendant");
            }
        }
    }

    function focusSearchField(selectText: boolean): void {
        if (!searchInput) {
            return;
        }

        searchInput.focus({ preventScroll: true });

        if (selectText && searchInput.value) {
            searchInput.select();
        }

        if (searchResults && searchInput.value && renderedSearchCount > 0) {
            searchResults.hidden = false;
            syncSearchControls(normalizeSearchQuery(searchInput.value));
        }
    }

    function isTextEntryTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        return target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement ||
            target.isContentEditable;
    }

    function isEnterTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        return isTextEntryTarget(target) ||
            target instanceof HTMLButtonElement ||
            target instanceof HTMLAnchorElement ||
            target.getAttribute("role") === "button" ||
            target.getAttribute("role") === "option";
    }

    function normalizeSearchQuery(value: string): string {
        return value.trim().toLowerCase();
    }

    function hideSearchResults(): void {
        activeSearchIndex = -1;
        if (searchResults) {
            searchResults.hidden = true;
        }
        syncSearchControls(searchInput ? normalizeSearchQuery(searchInput.value) : "");
    }

    function setActiveSearchIndex(index: number): void {
        if (!searchResults || renderedSearchCount === 0) {
            return;
        }

        activeSearchIndex = (index + renderedSearchCount) % renderedSearchCount;

        for (const [resultIndex, child] of Array.from(searchResults.children).entries()) {
            const result = child as HTMLElement;
            const isActive = resultIndex === activeSearchIndex;
            result.classList.toggle("is-active", isActive);
            result.setAttribute("aria-selected", isActive ? "true" : "false");
        }

        const activeResult = searchResults.children[activeSearchIndex] as HTMLElement | undefined;
        activeResult?.scrollIntoView({ block: "nearest" });
        syncSearchControls(searchInput ? normalizeSearchQuery(searchInput.value) : "");
    }

    function selectSearchSite(site: MappedSite): void {
        if (!map || !searchInput) {
            return;
        }

        searchInput.value = site.contractor;
        visibleSites = [site];
        setProjectData(map, visibleSites);
        renderedSearchCount = 0;
        searchResults?.replaceChildren();
        hideSearchResults();
        focusOnSite(map, site);
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

        activeSearchIndex = -1;

        if (!query) {
            visibleSites = allSites;
            renderedSearchCount = 0;
            searchResults.hidden = true;
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
            site.zip.includes(query) ||
            Boolean(site.caseReference?.includes(query)),
        );

        if (map) {
            setProjectData(map, visibleSites);
        }

        renderedSearchCount = renderSearchResults(searchResults, visibleSites, activeSearchIndex, selectSearchSite);
        syncSearchControls(query);
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
                cluster: true,
                clusterMaxZoom: 11,
                clusterRadius: 38,
            });

            loadedMap.addLayer({
                id: PROJECT_CLUSTER_LAYER_ID,
                type: "circle",
                source: PROJECT_SOURCE_ID,
                filter: ["has", "point_count"],
                paint: {
                    "circle-color": [
                        "step",
                        ["get", "point_count"],
                        "#d7263d",
                        20,
                        "#b91c37",
                        60,
                        "#8f172a",
                    ],
                    "circle-opacity": 0.9,
                    "circle-radius": [
                        "step",
                        ["get", "point_count"],
                        14,
                        20,
                        18,
                        60,
                        23,
                    ],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff",
                },
            });

            loadedMap.addLayer({
                id: PROJECT_CLUSTER_COUNT_LAYER_ID,
                type: "symbol",
                source: PROJECT_SOURCE_ID,
                filter: ["has", "point_count"],
                layout: {
                    "text-field": ["get", "point_count_abbreviated"],
                    "text-font": ["Noto Sans Regular"],
                    "text-size": 11,
                    "text-allow-overlap": true,
                },
                paint: {
                    "text-color": "#ffffff",
                },
            });

            loadedMap.addLayer({
                id: PROJECT_LAYER_ID,
                type: "circle",
                source: PROJECT_SOURCE_ID,
                filter: ["!", ["has", "point_count"]],
                paint: {
                    "circle-color": "#d7263d",
                    "circle-opacity": 0.88,
                    "circle-radius": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        9,
                        4,
                        14,
                        8,
                    ],
                    "circle-stroke-width": 1.5,
                    "circle-stroke-color": "#ffffff",
                },
            });

            loadedMap.on("click", PROJECT_CLUSTER_LAYER_ID, (event) => {
                const feature = event.features?.[0];
                const clusterId = feature?.properties?.cluster_id;
                const geometry = feature?.geometry;
                const source = loadedMap.getSource(PROJECT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
                if (typeof clusterId !== "number" || geometry?.type !== "Point" || !source) {
                    return;
                }

                const coordinates = geometry.coordinates as [number, number];
                void source.getClusterExpansionZoom(clusterId).then((zoom) => {
                    loadedMap.easeTo({
                        center: coordinates,
                        zoom,
                    });
                });
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

                openProjectPopup(loadedMap, coordinates, properties);
            });

            loadedMap.on("mouseenter", PROJECT_LAYER_ID, () => {
                loadedMap.getCanvas().style.setProperty("cursor", "pointer");
            });

            loadedMap.on("mouseenter", PROJECT_CLUSTER_LAYER_ID, () => {
                loadedMap.getCanvas().style.setProperty("cursor", "pointer");
            });

            loadedMap.on("mouseleave", PROJECT_LAYER_ID, () => {
                loadedMap.getCanvas().style.setProperty("cursor", "");
            });

            loadedMap.on("mouseleave", PROJECT_CLUSTER_LAYER_ID, () => {
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
                applySearch(normalizeSearchQuery((event.target as HTMLInputElement).value));
            });

            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && activePopup) {
                    event.preventDefault();
                    closeActivePopup();
                    return;
                }

                if (event.key === "ArrowDown" && renderedSearchCount > 0) {
                    event.preventDefault();
                    searchResults.hidden = false;
                    setActiveSearchIndex(activeSearchIndex + 1);
                    return;
                }

                if (event.key === "ArrowUp" && renderedSearchCount > 0) {
                    event.preventDefault();
                    searchResults.hidden = false;
                    setActiveSearchIndex(activeSearchIndex === -1 ? renderedSearchCount - 1 : activeSearchIndex - 1);
                    return;
                }

                if (event.key === "Enter" && !searchResults.hidden && renderedSearchCount > 0) {
                    event.preventDefault();
                    const selectedIndex = activeSearchIndex >= 0 ? activeSearchIndex : 0;
                    const selectedSite = visibleSites[selectedIndex];
                    if (selectedSite) {
                        selectSearchSite(selectedSite);
                    }
                    return;
                }

                if (event.key === "Escape" && !searchResults.hidden) {
                    event.preventDefault();
                    hideSearchResults();
                    return;
                }

                if (event.key === "Escape" && searchInput.value) {
                    event.preventDefault();
                    clearSearch();
                }
            });

            document.addEventListener("click", (event) => {
                const target = event.target;
                if (target instanceof Node &&
                    searchContainer instanceof HTMLElement &&
                    !searchContainer.contains(target)) {
                    hideSearchResults();
                }
            });

            document.addEventListener("keydown", (event) => {
                const key = event.key.toLowerCase();
                if ((event.ctrlKey || event.metaKey) && key === "f") {
                    event.preventDefault();
                    focusSearchField(true);
                    return;
                }

                if (event.key === "Escape" && activePopup) {
                    event.preventDefault();
                    closeActivePopup();
                    return;
                }

                if (event.key === "Enter" &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey &&
                    !isEnterTarget(event.target)) {
                    event.preventDefault();
                    focusSearchField(false);
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
