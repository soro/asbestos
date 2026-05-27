import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { dateKey, getAddressKey, getStrictProjectMatchKey, hasCoordinates } from "./data";
import {
    GeocodedResult,
    NormalizedProject,
    NycDepAcp7ProjectSource,
    NysDolProjectSource,
    ProjectAddress,
    ProjectCoordinates,
    ProjectSourceRecord,
} from "./types";

const DOL_INPUT = path.join(__dirname, "../output.json");
const ACP7_INPUT = path.join(__dirname, "../acp7_output.json");
const PROJECTS_OUTPUT = path.join(__dirname, "../projects.json");

function hash(value: string): string {
    return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function getConfiguredPath(envName: string, defaultPath: string): string {
    return process.env[envName]?.trim() || defaultPath;
}

function clean(value: string | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ");
}

function buildDolAddress(site: GeocodedResult): ProjectAddress {
    return {
        street: clean(site.street),
        city: clean(site.city),
        state: "NY",
        zip: clean(site.zip),
    };
}

function buildDolCoordinates(site: GeocodedResult): ProjectCoordinates | undefined {
    if (!hasCoordinates(site)) {
        return undefined;
    }

    return {
        lat: site.lat,
        lng: site.lng,
        source: site.geocodingProvider ? "geocoder" : "nys_dol",
        provider: site.geocodingProvider,
    };
}

function buildDolSource(site: GeocodedResult): NysDolProjectSource {
    const address = buildDolAddress(site);
    const sourceId = site.caseReference || hash([
        site.contractor,
        site.start,
        site.end,
        site.street,
        site.city,
        site.zip,
    ].join("|"));

    return {
        source: "nys_dol",
        sourceId,
        caseReference: site.caseReference,
        contractor: clean(site.contractor),
        start: dateKey(site.start),
        end: dateKey(site.end),
        address,
        coordinates: buildDolCoordinates(site),
    };
}

function buildProjectId(source: ProjectSourceRecord): string {
    return `${source.source}:${source.sourceId}`;
}

function buildProjectFromSource(source: ProjectSourceRecord): NormalizedProject {
    return {
        id: buildProjectId(source),
        title: source.contractor,
        contractor: source.contractor,
        start: source.start,
        end: source.end,
        address: source.address,
        addressKey: getAddressKey(source.address),
        coordinates: source.coordinates,
        sources: [source],
    };
}

function mergeSourceIntoProject(project: NormalizedProject, source: ProjectSourceRecord): void {
    if (project.sources.some((existingSource) =>
        existingSource.source === source.source && existingSource.sourceId === source.sourceId)) {
        return;
    }

    project.sources.push(source);

    if (!project.coordinates && source.coordinates) {
        project.coordinates = source.coordinates;
    }

    const hasAcp7Address = source.source === "nyc_dep_acp7" &&
        Boolean(source.address.bbl || source.address.nta || source.address.communityBoard || source.address.councilDistrict);
    if (hasAcp7Address) {
        project.address = {
            ...source.address,
            street: project.address.street || source.address.street,
            city: project.address.city || source.address.city,
            zip: project.address.zip || source.address.zip,
        };
        project.addressKey = getAddressKey(project.address);
    }
}

function strictKeyForSource(source: ProjectSourceRecord): string {
    return getStrictProjectMatchKey({
        contractor: source.contractor,
        start: source.start,
        end: source.end,
        address: source.address,
    });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sortProjects(projects: NormalizedProject[]): NormalizedProject[] {
    return projects.sort((left, right) =>
        left.start.localeCompare(right.start) ||
        left.address.street.localeCompare(right.address.street) ||
        left.contractor.localeCompare(right.contractor) ||
        left.id.localeCompare(right.id));
}

function countMultiProjectAddresses(projects: NormalizedProject[]): number {
    const counts = new Map<string, number>();
    for (const project of projects) {
        counts.set(project.addressKey, (counts.get(project.addressKey) ?? 0) + 1);
    }

    return Array.from(counts.values()).filter((count) => count > 1).length;
}

function main(): void {
    const dolInput = getConfiguredPath("DOL_OUTPUT_FILE", DOL_INPUT);
    const acp7Input = getConfiguredPath("ACP7_OUTPUT_FILE", ACP7_INPUT);
    const projectsOutput = getConfiguredPath("PROJECTS_OUTPUT_FILE", PROJECTS_OUTPUT);

    const dolSites = readJsonFile<GeocodedResult[]>(dolInput, []);
    const acp7Projects = readJsonFile<NycDepAcp7ProjectSource[]>(acp7Input, []);
    const normalizedProjects: NormalizedProject[] = [];
    const projectsByStrictKey = new Map<string, NormalizedProject>();

    for (const site of dolSites) {
        const source = buildDolSource(site);
        const project = buildProjectFromSource(source);
        normalizedProjects.push(project);

        const strictKey = strictKeyForSource(source);
        if (!projectsByStrictKey.has(strictKey)) {
            projectsByStrictKey.set(strictKey, project);
        }
    }

    let mergedAcp7Count = 0;
    for (const acp7Project of acp7Projects) {
        const strictKey = strictKeyForSource(acp7Project);
        const existingProject = projectsByStrictKey.get(strictKey);

        if (existingProject && existingProject.sources.some((source) => source.source === "nys_dol")) {
            mergeSourceIntoProject(existingProject, acp7Project);
            mergedAcp7Count += 1;
        } else {
            const project = buildProjectFromSource(acp7Project);
            normalizedProjects.push(project);

            if (!projectsByStrictKey.has(strictKey)) {
                projectsByStrictKey.set(strictKey, project);
            }
        }
    }

    const sortedProjects = sortProjects(normalizedProjects);
    fs.writeFileSync(projectsOutput, JSON.stringify(sortedProjects, null, 2));

    console.log(`Read ${dolSites.length} NYS DOL projects from ${dolInput}.`);
    console.log(`Read ${acp7Projects.length} NYC DEP ACP7 projects from ${acp7Input}.`);
    console.log(`Merged ${mergedAcp7Count} ACP7 projects into strict DOL matches.`);
    console.log(`Saved ${sortedProjects.length} normalized projects to ${projectsOutput}.`);
    console.log(`${countMultiProjectAddresses(sortedProjects)} addresses have multiple project records.`);
}

main();
