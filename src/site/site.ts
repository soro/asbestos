import maplibregl, { type LngLatLike, type PositionAnchor } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import { BASEMAP_BOUNDS, BASEMAP_FILENAME } from "../basemap";
import { formatProjectDate } from "../data";
import {
    Acp7MaterialDetail,
    NormalizedProject,
    NycDepAcp7ProjectSource,
    ProjectAddress,
    ProjectCoordinates,
    ProjectSourceRecord,
} from "../types";

const MAX_SEARCH_RESULTS = 10;
const PROJECT_SOURCE_ID = "asbestos-projects";
const PROJECT_CLUSTER_LAYER_ID = "project-clusters";
const PROJECT_CLUSTER_COUNT_LAYER_ID = "project-cluster-count";
const PROJECT_LAYER_ID = "projects-circles";
const SEARCH_RESULT_ID_PREFIX = "search-result";
const PROTOMAPS_GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const PROTOMAPS_GRAYSCALE_SPRITE_URL = "https://protomaps.github.io/basemaps-assets/sprites/v4/grayscale";
const POPUP_EDGE_PADDING = 16;
const POPUP_MIN_CONTENT_HEIGHT = 160;
const POPUP_MAX_CONTENT_HEIGHT = 620;
const POPUP_TIP_AND_SAFETY_SPACE = 36;

type BasemapMode = "pmtiles" | "raster";
type MappedProject = NormalizedProject & { coordinates: ProjectCoordinates };
type MappedLocation = {
    id: string;
    addressKey: string;
    address: ProjectAddress;
    lat: number;
    lng: number;
    projects: MappedProject[];
    selectedProjectId?: string;
    searchText: string;
};

type ProjectFeatureProperties = {
    locationId: string;
    projectId: string;
    title: string;
    address: string;
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

export async function getAllProjects(): Promise<NormalizedProject[]> {
    const response = await fetch("projects.json");
    if (!response.ok) {
        throw new Error(`Failed to load project data (${response.status})`);
    }

    return response.json() as Promise<NormalizedProject[]>;
}

function hasProjectCoordinates(project: NormalizedProject): project is MappedProject {
    return Boolean(project.coordinates &&
        typeof project.coordinates.lat === "number" &&
        Number.isFinite(project.coordinates.lat) &&
        typeof project.coordinates.lng === "number" &&
        Number.isFinite(project.coordinates.lng));
}

function formatAddress(address: ProjectAddress): string {
    return [
        address.street,
        address.city,
        address.zip,
    ].filter((part) => part.trim().length > 0).join(", ");
}

function getLocationTitle(location: MappedLocation): string {
    const project = getSelectedProject(location);

    if (project) {
        return project.contractor;
    }

    return `${location.projects.length} projects`;
}

function getSelectedProject(location: MappedLocation): MappedProject | undefined {
    return location.selectedProjectId
        ? location.projects.find((project) => project.id === location.selectedProjectId)
        : location.projects[0];
}

function getSourceLabel(source: ProjectSourceRecord["source"]): string {
    return source === "nyc_dep_acp7" ? "NYC DEP" : "NYS DOL";
}

function getProjectSourceLabels(project: NormalizedProject): string[] {
    return Array.from(new Set(project.sources.map((source) => getSourceLabel(source.source))));
}

function getAcp7Sources(project: NormalizedProject): NycDepAcp7ProjectSource[] {
    return project.sources.filter((source): source is NycDepAcp7ProjectSource => source.source === "nyc_dep_acp7");
}

function getProjectIdentifierLabels(project: NormalizedProject): string[] {
    return project.sources.flatMap((source) => {
        if (source.source === "nys_dol" && source.caseReference) {
            return [`Case ${source.caseReference}`];
        }

        if (source.source === "nyc_dep_acp7") {
            return [source.tru];
        }

        return [];
    });
}

function createSourceBadges(project: NormalizedProject): HTMLElement {
    const badges = document.createElement("div");
    badges.className = "project-popup__badges";

    for (const label of getProjectSourceLabels(project)) {
        const badge = document.createElement("span");
        badge.className = "project-popup__badge";
        badge.textContent = label;
        badges.appendChild(badge);
    }

    return badges;
}

function appendIfPresent(details: HTMLElement, label: string, value: string | undefined): void {
    if (!value || value.trim().length === 0) {
        return;
    }

    appendPopupDetail(details, label, value);
}

function appendProjectDateDetails(details: HTMLElement, project: NormalizedProject): void {
    appendPopupDetail(details, "Start", formatProjectDate(project.start));
    appendPopupDetail(details, "End", formatProjectDate(project.end));
}

function appendSourceIdDetails(details: HTMLElement, project: NormalizedProject): void {
    for (const source of project.sources) {
        if (source.source === "nys_dol" && source.caseReference) {
            appendPopupDetail(details, "Case", source.caseReference);
        }

        if (source.source === "nyc_dep_acp7") {
            appendPopupDetail(details, "TRU", source.tru);
            appendPopupDetail(details, "Status", source.status);
        }
    }
}

function createAcp7ExtendedDetails(project: NormalizedProject): HTMLElement | null {
    const acp7Sources = getAcp7Sources(project);
    if (acp7Sources.length === 0) {
        return null;
    }

    const wrapper = document.createElement("details");
    wrapper.className = "project-popup__extended-details";

    const summary = document.createElement("summary");
    summary.className = "project-popup__extended-summary";
    summary.textContent = "Additional details";
    wrapper.appendChild(summary);

    for (const source of acp7Sources) {
        const section = document.createElement("div");
        section.className = "project-popup__extended";

        const details = document.createElement("div");
        details.className = "project-popup__details project-popup__details--extended";
        appendIfPresent(details, "Facility", source.facilityAka);
        appendIfPresent(details, "Type", source.facilityType);
        appendIfPresent(details, "Owner", source.buildingOwnerName);
        appendIfPresent(details, "Monitor", source.airMonitorName);
        appendIfPresent(details, "BBL", source.address.bbl);
        appendIfPresent(details, "NTA", source.address.nta);
        appendIfPresent(details, "CB", source.address.communityBoard);
        appendIfPresent(details, "Council", source.address.councilDistrict);

        if (details.children.length > 0) {
            section.appendChild(details);
        }

        if (source.materialDetails.length > 0) {
            section.appendChild(createMaterialDetails(source.materialDetails));
        }

        if (section.children.length > 0) {
            wrapper.appendChild(section);
        }
    }

    return wrapper.children.length > 1 ? wrapper : null;
}

function createMaterialDetails(materialDetails: Acp7MaterialDetail[]): HTMLElement {
    const wrapper = document.createElement("details");
    wrapper.className = "project-popup__materials";

    const summary = document.createElement("summary");
    summary.className = "project-popup__materials-summary";
    summary.textContent = `Materials (${materialDetails.length})`;
    wrapper.appendChild(summary);

    const list = document.createElement("div");
    list.className = "project-popup__material-list";

    for (const detail of materialDetails) {
        const item = document.createElement("div");
        item.className = "project-popup__material";

        const titleParts = [
            detail.floor ? `Floor ${detail.floor}` : undefined,
            detail.section,
        ].filter((part): part is string => Boolean(part));

        const title = document.createElement("div");
        title.className = "project-popup__material-title";
        title.textContent = titleParts.length > 0 ? titleParts.join(" - ") : "Material detail";
        item.appendChild(title);

        const details = document.createElement("div");
        details.className = "project-popup__material-meta";

        appendIfPresent(details, "Material", detail.acmType);
        if (typeof detail.acmAmount === "number") {
            appendPopupDetail(details, "Amount", `${detail.acmAmount}${detail.acmUnit ? ` ${detail.acmUnit}` : ""}`);
        }
        appendIfPresent(details, "Work", detail.abatementType);
        appendIfPresent(details, "Method", detail.procedureName);

        item.appendChild(details);
        list.appendChild(item);
    }

    wrapper.appendChild(list);
    return wrapper;
}

function createProjectBody(project: NormalizedProject): HTMLElement {
    const body = document.createElement("div");
    body.className = "project-popup__project-body";

    const details = document.createElement("div");
    details.className = "project-popup__details";
    appendProjectDateDetails(details, project);
    appendSourceIdDetails(details, project);
    body.appendChild(details);

    const extendedDetails = createAcp7ExtendedDetails(project);
    if (extendedDetails) {
        body.appendChild(extendedDetails);
    }

    return body;
}

function createProjectSummary(project: NormalizedProject): HTMLElement {
    const summaryContent = document.createElement("div");
    summaryContent.className = "project-popup__summary-content";

    const title = document.createElement("div");
    title.className = "project-popup__project-title";
    title.textContent = project.contractor;

    const meta = document.createElement("div");
    meta.className = "project-popup__project-meta";
    const identifiers = getProjectIdentifierLabels(project);
    meta.textContent = [
        `${formatProjectDate(project.start)} - ${formatProjectDate(project.end)}`,
        ...identifiers,
    ].join(" | ");

    summaryContent.append(title, meta, createSourceBadges(project));
    return summaryContent;
}

function createProjectSection(project: NormalizedProject, forceOpen: boolean): HTMLElement {
    const section = document.createElement("details");
    section.className = "project-popup__project";
    section.open = forceOpen;

    const summary = document.createElement("summary");
    summary.className = "project-popup__summary";
    summary.appendChild(createProjectSummary(project));

    section.append(summary, createProjectBody(project));
    return section;
}

function createPopupContent(location: MappedLocation): HTMLElement {
    const container = document.createElement("div");
    container.className = "project-popup";

    const title = document.createElement("div");
    title.className = "project-popup__title";
    title.textContent = getLocationTitle(location);

    const address = document.createElement("div");
    address.className = "project-popup__address";
    address.textContent = formatAddress(location.address);

    const selectedProject = getSelectedProject(location);
    if (location.projects.length === 1 && selectedProject) {
        const badges = createSourceBadges(selectedProject);
        badges.classList.add("project-popup__badges--top");

        const body = createProjectBody(selectedProject);
        body.classList.add("project-popup__project-body--single");

        container.append(title, address, badges, body);
        return container;
    }

    const projects = document.createElement("div");
    projects.className = "project-popup__projects";

    location.projects.forEach((project, index) => {
        projects.appendChild(createProjectSection(
            project,
            location.projects.length === 1 || project.id === location.selectedProjectId || (!location.selectedProjectId && index === 0),
        ));
    });

    container.append(title, address, projects);

    return container;
}

function appendPopupDetail(details: HTMLElement, label: string, value: string): void {
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

function getGeoJson(locations: MappedLocation[]): GeoJSON.FeatureCollection<GeoJSON.Point, ProjectFeatureProperties> {
    return {
        type: "FeatureCollection",
        features: locations.map((location) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [location.lng, location.lat],
            },
            properties: {
                locationId: location.id,
                projectId: location.selectedProjectId ?? location.id,
                title: getLocationTitle(location),
                address: formatAddress(location.address),
            },
        })),
    };
}

function setProjectData(map: maplibregl.Map, locations: MappedLocation[]): void {
    const source = map.getSource(PROJECT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
        source.setData(getGeoJson(locations));
    }
}

function focusOnLocation(map: maplibregl.Map, location: MappedLocation): void {
    const coordinates: [number, number] = [location.lng, location.lat];

    map.flyTo({
        center: coordinates,
        zoom: 15,
    });

    openProjectPopup(map, coordinates, location, "top");
}

function openProjectPopup(
    map: maplibregl.Map,
    coordinates: [number, number],
    location: MappedLocation,
    anchor: PositionAnchor = getPreferredPopupAnchor(map, coordinates),
): void {
    closeActivePopup();

    const content = createPopupContent(location);
    const popup = new maplibregl.Popup({
        anchor,
        maxWidth: "430px",
        padding: {
            top: POPUP_EDGE_PADDING,
            right: POPUP_EDGE_PADDING,
            bottom: POPUP_EDGE_PADDING,
            left: POPUP_EDGE_PADDING,
        },
    })
        .setLngLat(coordinates)
        .setDOMContent(content)
        .addTo(map);

    repositionPopupOnContentResize(map, popup, content);

    activePopup = popup;
    popup.on("close", () => {
        if (activePopup === popup) {
            activePopup = null;
        }
    });
}

function repositionPopupOnContentResize(map: maplibregl.Map, popup: maplibregl.Popup, content: HTMLElement): void {
    if (!("ResizeObserver" in window)) {
        return;
    }

    let frameId = 0;
    let shouldMeasureNaturalSize = false;
    let shouldReconsiderAnchor = false;
    const reposition = (measureNaturalSize = false, reconsiderAnchor = false) => {
        shouldMeasureNaturalSize = shouldMeasureNaturalSize || measureNaturalSize;
        shouldReconsiderAnchor = shouldReconsiderAnchor || reconsiderAnchor;

        if (frameId) {
            window.cancelAnimationFrame(frameId);
        }

        frameId = window.requestAnimationFrame(() => {
            updatePopupLayout(map, popup, content, shouldMeasureNaturalSize, shouldReconsiderAnchor);
            shouldMeasureNaturalSize = false;
            shouldReconsiderAnchor = false;
            frameId = 0;
        });
    };
    const repositionWithinCurrentLayout = () => reposition();
    const repositionAfterToggle = () => reposition(true, true);
    const reconsiderAnchorAfterMove = () => reposition(true, true);

    const observer = new ResizeObserver(repositionWithinCurrentLayout);
    observer.observe(content);
    window.addEventListener("resize", repositionWithinCurrentLayout);
    content.addEventListener("toggle", repositionAfterToggle, true);
    map.on("moveend", reconsiderAnchorAfterMove);
    reposition();

    popup.on("close", () => {
        observer.disconnect();
        window.removeEventListener("resize", repositionWithinCurrentLayout);
        content.removeEventListener("toggle", repositionAfterToggle, true);
        map.off("moveend", reconsiderAnchorAfterMove);
        if (frameId) {
            window.cancelAnimationFrame(frameId);
        }
    });
}

function updatePopupLayout(
    map: maplibregl.Map,
    popup: maplibregl.Popup,
    content: HTMLElement,
    measureNaturalSize: boolean,
    reconsiderAnchor: boolean,
): void {
    const container = content.closest<HTMLElement>(".maplibregl-popup");
    if (!container) {
        return;
    }

    if (reconsiderAnchor) {
        const preferredAnchor = getPreferredPopupAnchor(map, popup.getLngLat());
        if (popup.options.anchor !== preferredAnchor) {
            popup.options.anchor = preferredAnchor;
            popup.setLngLat(popup.getLngLat());
        }
    }

    if (measureNaturalSize) {
        content.style.maxHeight = "";
    }

    const viewport = getPopupViewport(map, popup);
    if (isPopupWithinViewport(container, viewport)) {
        return;
    }

    const currentAnchor = getPopupAnchor(container);
    const currentAvailableHeight = getAvailableHeightForAnchor(currentAnchor, viewport);
    setPopupContentMaxHeight(content, currentAvailableHeight);

    if (isPopupWithinViewport(container, viewport)) {
        return;
    }

    setPopupContentMaxHeight(content, Math.max(viewport.availableAbove, viewport.availableBelow));
    popup.options.anchor = getBestPopupAnchor(map, popup.getLngLat());
    popup.setLngLat(popup.getLngLat());
}

type PopupViewport = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    availableAbove: number;
    availableBelow: number;
};

function getPopupViewport(map: maplibregl.Map, popup: maplibregl.Popup): PopupViewport {
    const mapRect = map.getContainer().getBoundingClientRect();
    const anchorPoint = map.project(popup.getLngLat());
    const anchorY = mapRect.top + anchorPoint.y;
    const top = Math.max(mapRect.top, POPUP_EDGE_PADDING);
    const right = Math.min(mapRect.right, window.innerWidth - POPUP_EDGE_PADDING);
    const bottom = Math.min(mapRect.bottom, window.innerHeight - POPUP_EDGE_PADDING);
    const left = Math.max(mapRect.left, POPUP_EDGE_PADDING);

    return {
        top,
        right,
        bottom,
        left,
        availableAbove: Math.max(0, anchorY - top),
        availableBelow: Math.max(0, bottom - anchorY),
    };
}

function isPopupWithinViewport(container: HTMLElement, viewport: PopupViewport): boolean {
    const rect = container.getBoundingClientRect();
    return rect.top >= viewport.top &&
        rect.right <= viewport.right &&
        rect.bottom <= viewport.bottom &&
        rect.left >= viewport.left;
}

function getPopupAnchor(container: HTMLElement): string {
    const anchorClass = Array.from(container.classList)
        .find((className) => className.startsWith("maplibregl-popup-anchor-"));

    return anchorClass?.replace("maplibregl-popup-anchor-", "") ?? "bottom";
}

function getAvailableHeightForAnchor(anchor: string, viewport: PopupViewport): number {
    if (anchor.includes("bottom")) {
        return viewport.availableAbove;
    }

    if (anchor.includes("top")) {
        return viewport.availableBelow;
    }

    return Math.max(viewport.availableAbove, viewport.availableBelow);
}

function setPopupContentMaxHeight(content: HTMLElement, availableHeight: number): void {
    const popupContent = content.closest<HTMLElement>(".maplibregl-popup-content");
    const popupContentStyle = popupContent ? window.getComputedStyle(popupContent) : null;
    const popupChromeHeight = popupContentStyle
        ? Number.parseFloat(popupContentStyle.paddingTop) + Number.parseFloat(popupContentStyle.paddingBottom)
        : 36;
    const maxContentHeight = Math.max(
        POPUP_MIN_CONTENT_HEIGHT,
        Math.min(POPUP_MAX_CONTENT_HEIGHT, availableHeight - popupChromeHeight - POPUP_TIP_AND_SAFETY_SPACE),
    );

    content.style.maxHeight = `${Math.floor(maxContentHeight)}px`;
}

function getPreferredPopupAnchor(map: maplibregl.Map, coordinates: LngLatLike): PositionAnchor {
    const viewport = getPopupAnchorViewport(map, coordinates);
    const comfortableDownwardSpace = Math.min(360, map.getContainer().clientHeight * 0.55);
    const verticalAnchor = viewport.availableBelow >= comfortableDownwardSpace ||
        viewport.availableBelow >= viewport.availableAbove
        ? "top"
        : "bottom";

    return getPositionAnchor(map, coordinates, verticalAnchor);
}

function getBestPopupAnchor(map: maplibregl.Map, coordinates: LngLatLike): PositionAnchor {
    const viewport = getPopupAnchorViewport(map, coordinates);
    return getPositionAnchor(
        map,
        coordinates,
        viewport.availableBelow >= viewport.availableAbove ? "top" : "bottom",
    );
}

function getPositionAnchor(
    map: maplibregl.Map,
    coordinates: LngLatLike,
    verticalAnchor: "top" | "bottom",
): PositionAnchor {
    const point = map.project(coordinates);
    const mapWidth = map.getContainer().clientWidth;
    const popupWidth = mapWidth <= 720
        ? Math.max(160, Math.min(280, mapWidth - 64))
        : Math.max(280, Math.min(430, mapWidth - (POPUP_EDGE_PADDING * 2)));
    const halfPopupWidth = popupWidth / 2;

    if (point.x < halfPopupWidth + POPUP_EDGE_PADDING) {
        return `${verticalAnchor}-left`;
    }

    if (point.x > mapWidth - halfPopupWidth - POPUP_EDGE_PADDING) {
        return `${verticalAnchor}-right`;
    }

    return verticalAnchor;
}

function getPopupAnchorViewport(map: maplibregl.Map, coordinates: LngLatLike): Pick<PopupViewport, "availableAbove" | "availableBelow"> {
    const point = map.project(coordinates);
    const mapHeight = map.getContainer().clientHeight;

    return {
        availableAbove: Math.max(0, point.y - POPUP_EDGE_PADDING),
        availableBelow: Math.max(0, mapHeight - point.y - POPUP_EDGE_PADDING),
    };
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
    locations: MappedLocation[],
    activeIndex: number,
    onSelect: (location: MappedLocation) => void,
): number {
    container.replaceChildren();

    const visibleResults = locations.slice(0, MAX_SEARCH_RESULTS);
    for (const [index, location] of visibleResults.entries()) {
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
        title.textContent = getLocationTitle(location);

        const address = document.createElement("span");
        address.className = "result-address";
        address.textContent = formatAddress(location.address);

        const meta = document.createElement("span");
        meta.className = "result-meta";
        const selectedProject = getSelectedProject(location);
        meta.textContent = selectedProject
            ? getProjectSourceLabels(selectedProject).join(" + ")
            : `${location.projects.length} project records`;

        result.append(title, address, meta);

        result.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
        result.addEventListener("click", () => {
            onSelect(location);
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

function getProjectSearchText(project: NormalizedProject): string {
    const sourceText = project.sources.flatMap((source) => {
        if (source.source === "nys_dol") {
            return [source.caseReference ?? ""];
        }

        return [
            source.tru,
            source.status,
            source.facilityAka ?? "",
            source.facilityType ?? "",
            source.buildingOwnerName ?? "",
            source.airMonitorName ?? "",
            source.address.bbl ?? "",
            source.address.nta ?? "",
            ...source.materialDetails.flatMap((detail) => [
                detail.floor ?? "",
                detail.section ?? "",
                detail.acmType ?? "",
                detail.acmUnit ?? "",
                detail.abatementType ?? "",
                detail.procedureName ?? "",
            ]),
        ];
    });

    return [
        project.contractor,
        project.title,
        project.start,
        project.end,
        project.address.street,
        project.address.city,
        project.address.zip,
        project.address.borough ?? "",
        ...sourceText,
    ].join(" ").toLowerCase();
}

function createLocationSearchText(projects: MappedProject[], address: ProjectAddress): string {
    return [
        formatAddress(address),
        address.borough ?? "",
        ...projects.map(getProjectSearchText),
    ].join(" ").toLowerCase();
}

function sortLocationProjects(projects: MappedProject[]): MappedProject[] {
    return [...projects].sort((left, right) =>
        left.start.localeCompare(right.start) ||
        left.contractor.localeCompare(right.contractor) ||
        left.id.localeCompare(right.id));
}

function groupProjectsByAddress(projects: MappedProject[]): Map<string, MappedProject[]> {
    const projectsByAddress = new Map<string, MappedProject[]>();

    for (const project of projects) {
        const existingProjects = projectsByAddress.get(project.addressKey) ?? [];
        existingProjects.push(project);
        projectsByAddress.set(project.addressKey, existingProjects);
    }

    for (const [addressKey, groupedProjects] of projectsByAddress) {
        projectsByAddress.set(addressKey, sortLocationProjects(groupedProjects));
    }

    return projectsByAddress;
}

function createProjectLocations(projects: MappedProject[], projectsByAddress: Map<string, MappedProject[]>): MappedLocation[] {
    return projects.map((project) => {
        const groupedProjects = projectsByAddress.get(project.addressKey) ?? [project];
        const sortedProjects = sortLocationProjects(groupedProjects);
        return {
            id: project.id,
            addressKey: project.addressKey,
            address: project.address,
            lat: project.coordinates.lat,
            lng: project.coordinates.lng,
            projects: sortedProjects,
            selectedProjectId: project.id,
            searchText: createLocationSearchText([project], project.address),
        };
    }).sort((left, right) =>
        left.address.street.localeCompare(right.address.street) ||
        left.address.city.localeCompare(right.address.city) ||
        left.id.localeCompare(right.id));
}

export async function initMap(): Promise<void> {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    const searchClear = document.getElementById("search-clear") as HTMLButtonElement | null;
    const searchResults = document.getElementById("search-results");
    const searchContainer = document.querySelector(".search-container");

    let map: maplibregl.Map | null = null;
    let allProjects: MappedProject[] = [];
    let allLocations: MappedLocation[] = [];
    let visibleLocations: MappedLocation[] = [];
    let locationsById = new Map<string, MappedLocation>();
    let currentBasemapMode: BasemapMode = "pmtiles";
    let isSwitchingBasemap = false;
    let activeSearchIndex = -1;
    let renderedSearchCount = 0;

    function fitBoundsToLocations(locations: MappedLocation[]): void {
        if (!map) {
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        for (const location of locations) {
            bounds.extend([location.lng, location.lat]);
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

    function selectSearchLocation(location: MappedLocation): void {
        if (!map || !searchInput) {
            return;
        }

        searchInput.value = getLocationTitle(location);
        visibleLocations = [location];
        setProjectData(map, visibleLocations);
        renderedSearchCount = 0;
        searchResults?.replaceChildren();
        hideSearchResults();
        focusOnLocation(map, location);
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
            visibleLocations = allLocations;
            renderedSearchCount = 0;
            searchResults.hidden = true;
            searchResults.replaceChildren();
            if (map) {
                setProjectData(map, visibleLocations);
            }
            syncSearchControls(query);
            return;
        }

        visibleLocations = allLocations.filter((location) => location.searchText.includes(query));

        if (map) {
            setProjectData(map, visibleLocations);
        }

        renderedSearchCount = renderSearchResults(searchResults, visibleLocations, activeSearchIndex, selectSearchLocation);
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
                data: getGeoJson(visibleLocations),
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
                const location = properties ? locationsById.get(properties.locationId) : undefined;
                if (!location) {
                    return;
                }

                openProjectPopup(loadedMap, coordinates, location);
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

            fitBoundsToLocations(visibleLocations);
        });
    }

    syncSearchControls("");

    try {
        const loadedProjects = await getAllProjects();
        allProjects = loadedProjects.filter(hasProjectCoordinates);

        if (CONFIG.filterToNYC) {
            const bounds = CONFIG.nycBounds;
            allProjects = allProjects.filter((project) =>
                project.coordinates.lng >= bounds.minLng &&
                project.coordinates.lng <= bounds.maxLng &&
                project.coordinates.lat >= bounds.minLat &&
                project.coordinates.lat <= bounds.maxLat,
            );
        }

        const projectsByAddress = groupProjectsByAddress(allProjects);
        allLocations = createProjectLocations(allProjects, projectsByAddress);
        visibleLocations = allLocations;
        locationsById = new Map(allLocations.map((location) => [location.id, location]));

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
                    const selectedLocation = visibleLocations[selectedIndex];
                    if (selectedLocation) {
                        selectSearchLocation(selectedLocation);
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
