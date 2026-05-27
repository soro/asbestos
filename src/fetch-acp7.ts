import * as fs from "fs";
import * as path from "path";
import { buildAddressQuery, hasCoordinates } from "./data";
import { geocodeSites } from "./geocoding";
import { Acp7MaterialDetail, GeocodedResult, NycDepAcp7ProjectSource, ProjectAddress, ProjectCoordinates, SearchResult } from "./types";

const DEFAULT_ACP7_API_URL = "https://data.cityofnewyork.us/resource/vq35-j9qm.json";
const DEFAULT_OUTPUT_FILE = path.join(__dirname, "../acp7_output.json");
const DEFAULT_PAGE_SIZE = 50000;

interface Acp7ApiRow {
    tru?: string;
    start_date?: string;
    end_date?: string;
    status_description?: string;
    street_activity?: string;
    premise_no?: string;
    street_name?: string;
    borough?: string;
    zip_code?: string;
    facility_aka?: string;
    facility_type?: string;
    bin?: string;
    block?: string;
    lot?: string;
    cross_street_on?: string;
    cross_street_between?: string;
    cross_street_and?: string;
    building_owner_name?: string;
    contractor_name?: string;
    air_monitor_name?: string;
    entire_floor?: string;
    floor?: string;
    section?: string;
    acm_type?: string;
    acm_amount?: string;
    acm_unit?: string;
    abatement_type?: string;
    procedure_name?: string;
    latitude?: string;
    longitude?: string;
    community_board?: string;
    council_district?: string;
    census_tract?: string;
    bbl?: string;
    nta?: string;
}

function clean(value: string | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ");
}

function optional(value: string | undefined): string | undefined {
    const cleanedValue = clean(value);
    return cleanedValue.length > 0 ? cleanedValue : undefined;
}

function dateOnly(value: string | undefined): string {
    return clean(value).slice(0, 10);
}

function parseNumber(value: string | undefined): number | undefined {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function getActiveDate(): string {
    return process.env.ACP7_ACTIVE_DATE?.trim() || new Date().toISOString().slice(0, 10);
}

function getAcp7ApiUrl(): string {
    return process.env.ACP7_API_URL?.trim() || DEFAULT_ACP7_API_URL;
}

function getOutputFile(): string {
    return process.env.ACP7_OUTPUT_FILE?.trim() || DEFAULT_OUTPUT_FILE;
}

function getPageSize(): number {
    const parsedValue = Number(process.env.ACP7_PAGE_SIZE);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_PAGE_SIZE;
}

function escapeSoqlString(value: string): string {
    return value.replace(/'/g, "''");
}

function boroughToCity(borough: string | undefined): string {
    const cleanedBorough = clean(borough);
    if (cleanedBorough.toLowerCase() === "manhattan") {
        return "New York";
    }

    return cleanedBorough || "New York";
}

function buildStreetAddress(row: Acp7ApiRow): string {
    return clean([row.premise_no, row.street_name].map(clean).filter(Boolean).join(" "));
}

function parseCoordinates(row: Acp7ApiRow): ProjectCoordinates | undefined {
    const lat = parseNumber(row.latitude);
    const lng = parseNumber(row.longitude);

    if (typeof lat !== "number" || typeof lng !== "number") {
        return undefined;
    }

    return {
        lat,
        lng,
        source: "nyc_dep_acp7",
    };
}

function buildAddress(row: Acp7ApiRow): ProjectAddress {
    return {
        street: buildStreetAddress(row),
        city: boroughToCity(row.borough),
        state: "NY",
        zip: clean(row.zip_code),
        borough: optional(row.borough),
        bbl: optional(row.bbl),
        nta: optional(row.nta),
        communityBoard: optional(row.community_board),
        councilDistrict: optional(row.council_district),
        censusTract: optional(row.census_tract),
    };
}

function buildMaterialDetail(row: Acp7ApiRow): Acp7MaterialDetail {
    const detail: Acp7MaterialDetail = {};
    const amount = parseNumber(row.acm_amount);

    if (optional(row.floor)) {
        detail.floor = optional(row.floor);
    }

    if (optional(row.section)) {
        detail.section = optional(row.section);
    }

    if (optional(row.entire_floor)) {
        detail.entireFloor = optional(row.entire_floor);
    }

    if (optional(row.acm_type)) {
        detail.acmType = optional(row.acm_type);
    }

    if (typeof amount === "number") {
        detail.acmAmount = amount;
    }

    if (optional(row.acm_unit)) {
        detail.acmUnit = optional(row.acm_unit);
    }

    if (optional(row.abatement_type)) {
        detail.abatementType = optional(row.abatement_type);
    }

    if (optional(row.procedure_name)) {
        detail.procedureName = optional(row.procedure_name);
    }

    return detail;
}

function hasMaterialDetail(detail: Acp7MaterialDetail): boolean {
    return Object.keys(detail).length > 0;
}

function mergeMaterialDetail(project: NycDepAcp7ProjectSource, detail: Acp7MaterialDetail): void {
    if (!hasMaterialDetail(detail)) {
        return;
    }

    const serializedDetail = JSON.stringify(detail);
    if (!project.materialDetails.some((existingDetail) => JSON.stringify(existingDetail) === serializedDetail)) {
        project.materialDetails.push(detail);
    }
}

async function fetchAcp7Rows(activeDate: string): Promise<Acp7ApiRow[]> {
    const apiUrl = getAcp7ApiUrl();
    const pageSize = getPageSize();
    const rows: Acp7ApiRow[] = [];
    const headers: Record<string, string> = {};
    const appToken = process.env.SOCRATA_APP_TOKEN?.trim();

    if (appToken) {
        headers["X-App-Token"] = appToken;
    }

    for (let offset = 0; ; offset += pageSize) {
        const params = new URLSearchParams();
        params.set("$where", `status_description = 'Submitted' AND end_date >= '${escapeSoqlString(activeDate)}T00:00:00'`);
        params.set("$order", "tru, start_date, end_date");
        params.set("$limit", String(pageSize));
        params.set("$offset", String(offset));

        const response = await fetch(`${apiUrl}?${params}`, { headers });
        if (!response.ok) {
            throw new Error(`ACP7 request failed (${response.status}): ${await response.text()}`);
        }

        const pageRows = await response.json() as Acp7ApiRow[];
        rows.push(...pageRows);
        console.log(`Fetched ${pageRows.length} ACP7 rows at offset ${offset}.`);

        if (pageRows.length < pageSize) {
            return rows;
        }
    }
}

function normalizeAcp7Rows(rows: Acp7ApiRow[]): NycDepAcp7ProjectSource[] {
    const projects = new Map<string, NycDepAcp7ProjectSource>();

    for (const row of rows) {
        const tru = clean(row.tru);
        if (!tru) {
            continue;
        }

        let project = projects.get(tru);
        if (!project) {
            const contractor = clean(row.contractor_name);
            project = {
                source: "nyc_dep_acp7",
                sourceId: tru,
                tru,
                status: clean(row.status_description),
                contractor,
                start: dateOnly(row.start_date),
                end: dateOnly(row.end_date),
                address: buildAddress(row),
                coordinates: parseCoordinates(row),
                facilityAka: optional(row.facility_aka),
                facilityType: optional(row.facility_type),
                buildingOwnerName: optional(row.building_owner_name),
                airMonitorName: optional(row.air_monitor_name),
                materialDetails: [],
                rawRowCount: 0,
            };
            projects.set(tru, project);
        }

        project.rawRowCount += 1;

        if (!project.coordinates) {
            project.coordinates = parseCoordinates(row);
        }

        mergeMaterialDetail(project, buildMaterialDetail(row));
    }

    return Array.from(projects.values());
}

function toSearchResult(project: NycDepAcp7ProjectSource): SearchResult {
    return {
        contractor: project.contractor,
        start: project.start,
        end: project.end,
        street: project.address.street,
        city: project.address.city,
        zip: project.address.zip,
        caseReference: project.tru,
    };
}

async function geocodeMissingProjects(projects: NycDepAcp7ProjectSource[]): Promise<void> {
    const missingProjects = projects.filter((project) => !project.coordinates && project.address.street.length > 0);
    const skippedProjects = projects.filter((project) => !project.coordinates && project.address.street.length === 0);

    if (skippedProjects.length > 0) {
        console.log(`Skipping geocoding for ${skippedProjects.length} ACP7 projects without a street address.`);
    }

    if (missingProjects.length === 0) {
        console.log("All geocodable ACP7 projects have native coordinates.");
        return;
    }

    console.log(`Geocoding ${missingProjects.length} ACP7 projects without native coordinates...`);
    const geocodedResults = await geocodeSites(missingProjects.map(toSearchResult));
    const geocodedByQuery = new Map<string, GeocodedResult>();

    for (const result of geocodedResults) {
        geocodedByQuery.set(buildAddressQuery(result), result);
    }

    for (const project of missingProjects) {
        const geocodedResult = geocodedByQuery.get(buildAddressQuery(toSearchResult(project)));
        if (geocodedResult && hasCoordinates(geocodedResult)) {
            project.coordinates = {
                lat: geocodedResult.lat,
                lng: geocodedResult.lng,
                source: "geocoder",
                provider: geocodedResult.geocodingProvider,
            };
        }
    }
}

async function main(): Promise<void> {
    const activeDate = getActiveDate();
    console.log(`Fetching ACP7 projects with status Submitted and end date on or after ${activeDate}.`);

    const rows = await fetchAcp7Rows(activeDate);
    const projects = normalizeAcp7Rows(rows);
    await geocodeMissingProjects(projects);

    const outputFile = getOutputFile();
    fs.writeFileSync(outputFile, JSON.stringify(projects, null, 2));
    console.log(`Saved ${projects.length} ACP7 projects to ${outputFile}.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
