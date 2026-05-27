export interface SearchResult {
    contractor: string;
    start: string;
    end: string;
    street: string;
    zip: string;
    city: string;
    county?: string;
    caseReference?: string;
}

export interface GeocodedResult extends SearchResult {
    lat?: number;
    lng?: number;
    geocodingProvider?: string;
}

export type ProjectDataSource = "nys_dol" | "nyc_dep_acp7";

export type CoordinateSource = ProjectDataSource | "geocoder";

export interface ProjectAddress {
    street: string;
    city: string;
    state: "NY";
    zip: string;
    borough?: string;
    bbl?: string;
    nta?: string;
    communityBoard?: string;
    councilDistrict?: string;
    censusTract?: string;
}

export interface ProjectCoordinates {
    lat: number;
    lng: number;
    source: CoordinateSource;
    provider?: string;
}

export interface Acp7MaterialDetail {
    floor?: string;
    section?: string;
    entireFloor?: string;
    acmType?: string;
    acmAmount?: number;
    acmUnit?: string;
    abatementType?: string;
    procedureName?: string;
}

export interface NysDolProjectSource {
    source: "nys_dol";
    sourceId: string;
    caseReference?: string;
    contractor: string;
    start: string;
    end: string;
    address: ProjectAddress;
    coordinates?: ProjectCoordinates;
}

export interface NycDepAcp7ProjectSource {
    source: "nyc_dep_acp7";
    sourceId: string;
    tru: string;
    status: string;
    contractor: string;
    start: string;
    end: string;
    address: ProjectAddress;
    coordinates?: ProjectCoordinates;
    facilityAka?: string;
    facilityType?: string;
    buildingOwnerName?: string;
    airMonitorName?: string;
    materialDetails: Acp7MaterialDetail[];
    rawRowCount: number;
}

export type ProjectSourceRecord = NysDolProjectSource | NycDepAcp7ProjectSource;

export interface NormalizedProject {
    id: string;
    title: string;
    contractor: string;
    start: string;
    end: string;
    address: ProjectAddress;
    addressKey: string;
    coordinates?: ProjectCoordinates;
    sources: ProjectSourceRecord[];
}
