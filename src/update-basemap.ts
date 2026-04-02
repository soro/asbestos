import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { FileSource, PMTiles } from "pmtiles";
import {
    BASEMAP_BOUNDS,
    BASEMAP_FILENAME,
    BASEMAP_MAX_ZOOM,
    BASEMAP_TARGET_MAX_BYTES,
    getBasemapBoundingBox,
} from "./basemap";

const execFileAsync = promisify(execFile);

const BUILD_METADATA_URL = "https://build-metadata.protomaps.dev/builds.json";
const BUILD_DOWNLOAD_PREFIX = "https://build.protomaps.com/";
const GO_PMTILES_VERSION = process.env.GO_PMTILES_VERSION ?? "v1.30.1";
const DEFAULT_DOWNLOAD_THREADS = process.env.PMTILES_DOWNLOAD_THREADS ?? "8";
const DEFAULT_OVERFETCH = process.env.PMTILES_OVERFETCH ?? "0.05";
const OUTPUT_PATH = path.join(__dirname, "../src/static", BASEMAP_FILENAME);
const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

type BuildMetadataEntry = {
    key: string;
};

type ExtractedBasemapHeader = {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    maxZoom: number;
};

type GoPmtilesBinary = {
    archiveName: string;
    downloadUrl: string;
    expectedBinaryName: string;
};

function parseFlags(argv: string[]): { dryRun: boolean } {
    return {
        dryRun: argv.includes("--dry-run"),
    };
}

function printUsage(): void {
    console.log(`Usage: npm run refresh-basemap -- [--dry-run]

Rebuilds ${BASEMAP_FILENAME} from the latest Protomaps daily build, clipped to:
  ${getBasemapBoundingBox()}

Environment overrides:
  PROTOMAPS_BUILD_KEY       Pin a specific build key such as 20260313.pmtiles
  PROTOMAPS_SOURCE_URL      Use a full source archive URL instead of the daily build channel
  GO_PMTILES_VERSION        Override the go-pmtiles release tag (default: ${GO_PMTILES_VERSION})
  PMTILES_DOWNLOAD_THREADS  Override extract download parallelism (default: ${DEFAULT_DOWNLOAD_THREADS})
  PMTILES_OVERFETCH         Override extract overfetch ratio (default: ${DEFAULT_OVERFETCH})`);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
}

async function resolveSourceUrl(): Promise<{ buildKey: string; sourceUrl: string }> {
    const sourceUrlOverride = process.env.PROTOMAPS_SOURCE_URL?.trim();
    if (sourceUrlOverride) {
        return {
            buildKey: "custom",
            sourceUrl: sourceUrlOverride,
        };
    }

    const buildKeyOverride = process.env.PROTOMAPS_BUILD_KEY?.trim();
    if (buildKeyOverride) {
        return {
            buildKey: buildKeyOverride,
            sourceUrl: `${BUILD_DOWNLOAD_PREFIX}${buildKeyOverride}`,
        };
    }

    const builds = await fetchJson<BuildMetadataEntry[]>(BUILD_METADATA_URL);
    const latestBuild = builds
        .filter((entry) => entry.key.endsWith(".pmtiles"))
        .sort((left, right) => right.key.localeCompare(left.key))[0];

    if (!latestBuild) {
        throw new Error("No Protomaps daily builds were returned by the metadata API.");
    }

    return {
        buildKey: latestBuild.key,
        sourceUrl: `${BUILD_DOWNLOAD_PREFIX}${latestBuild.key}`,
    };
}

function getGoPmtilesBinary(): GoPmtilesBinary {
    const versionWithoutPrefix = GO_PMTILES_VERSION.replace(/^v/, "");

    if (process.platform === "linux" && process.arch === "x64") {
        const archiveName = `go-pmtiles_${versionWithoutPrefix}_Linux_x86_64.tar.gz`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles",
        };
    }

    if (process.platform === "linux" && process.arch === "arm64") {
        const archiveName = `go-pmtiles_${versionWithoutPrefix}_Linux_arm64.tar.gz`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles",
        };
    }

    if (process.platform === "darwin" && process.arch === "x64") {
        const archiveName = `go-pmtiles-${versionWithoutPrefix}_Darwin_x86_64.zip`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles",
        };
    }

    if (process.platform === "darwin" && process.arch === "arm64") {
        const archiveName = `go-pmtiles-${versionWithoutPrefix}_Darwin_arm64.zip`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles",
        };
    }

    if (process.platform === "win32" && process.arch === "x64") {
        const archiveName = `go-pmtiles_${versionWithoutPrefix}_Windows_x86_64.zip`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles.exe",
        };
    }

    if (process.platform === "win32" && process.arch === "arm64") {
        const archiveName = `go-pmtiles_${versionWithoutPrefix}_Windows_arm64.zip`;
        return {
            archiveName,
            downloadUrl: `https://github.com/protomaps/go-pmtiles/releases/download/${GO_PMTILES_VERSION}/${archiveName}`,
            expectedBinaryName: "pmtiles.exe",
        };
    }

    throw new Error(`Unsupported platform for basemap regeneration: ${process.platform} ${process.arch}`);
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(targetPath, Buffer.from(arrayBuffer));
}

async function findBinary(rootDir: string, binaryName: string): Promise<string | null> {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name === binaryName) {
            return entryPath;
        }

        if (entry.isDirectory()) {
            const nestedBinary = await findBinary(entryPath, binaryName);
            if (nestedBinary) {
                return nestedBinary;
            }
        }
    }

    return null;
}

async function ensureGoPmtilesBinary(): Promise<string> {
    const binary = getGoPmtilesBinary();
    const toolRoot = path.join(os.tmpdir(), "asbestos-go-pmtiles", GO_PMTILES_VERSION, `${process.platform}-${process.arch}`);
    const archivePath = path.join(toolRoot, binary.archiveName);
    const extractedBinaryPath = path.join(toolRoot, binary.expectedBinaryName);

    if (await pathExists(extractedBinaryPath)) {
        return extractedBinaryPath;
    }

    await fs.promises.mkdir(toolRoot, { recursive: true });

    if (!(await pathExists(archivePath))) {
        console.log(`Downloading ${binary.archiveName}...`);
        await downloadFile(binary.downloadUrl, archivePath);
    }

    if (binary.archiveName.endsWith(".tar.gz")) {
        await execFileAsync("tar", ["-xzf", archivePath, "-C", toolRoot]);
    } else if (binary.archiveName.endsWith(".zip")) {
        if (process.platform === "win32") {
            await execFileAsync("powershell", [
                "-NoProfile",
                "-Command",
                `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${toolRoot.replace(/'/g, "''")}' -Force`,
            ]);
        } else {
            await execFileAsync("unzip", ["-oq", archivePath, "-d", toolRoot]);
        }
    } else {
        throw new Error(`Unsupported archive format for ${binary.archiveName}`);
    }

    const resolvedBinaryPath = await findBinary(toolRoot, binary.expectedBinaryName);
    if (!resolvedBinaryPath) {
        throw new Error(`Unable to locate ${binary.expectedBinaryName} after extracting ${binary.archiveName}`);
    }

    if (process.platform !== "win32") {
        await fs.promises.chmod(resolvedBinaryPath, 0o755);
    }

    if (resolvedBinaryPath !== extractedBinaryPath) {
        await fs.promises.copyFile(resolvedBinaryPath, extractedBinaryPath);
        if (process.platform !== "win32") {
            await fs.promises.chmod(extractedBinaryPath, 0o755);
        }
    }

    return extractedBinaryPath;
}

async function readBasemapHeader(filePath: string): Promise<ExtractedBasemapHeader> {
    const file = new File([await fs.promises.readFile(filePath)], path.basename(filePath));
    const archive = new PMTiles(new FileSource(file));
    const header = await archive.getHeader();

    return {
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
        maxZoom: header.maxZoom,
    };
}

function approximatelyEqual(left: number, right: number): boolean {
    return Math.abs(left - right) < 1e-7;
}

async function verifyOutput(filePath: string): Promise<void> {
    const stats = await fs.promises.stat(filePath);
    if (stats.size > BASEMAP_TARGET_MAX_BYTES) {
        throw new Error(
            `${BASEMAP_FILENAME} is ${stats.size} bytes, which exceeds the ${BASEMAP_TARGET_MAX_BYTES}-byte GitHub Pages target.`,
        );
    }

    const header = await readBasemapHeader(filePath);
    if (header.maxZoom !== BASEMAP_MAX_ZOOM) {
        throw new Error(`Expected maxZoom ${BASEMAP_MAX_ZOOM}, received ${header.maxZoom}`);
    }

    if (!approximatelyEqual(header.minLon, BASEMAP_BOUNDS.minLng) ||
        !approximatelyEqual(header.minLat, BASEMAP_BOUNDS.minLat) ||
        !approximatelyEqual(header.maxLon, BASEMAP_BOUNDS.maxLng) ||
        !approximatelyEqual(header.maxLat, BASEMAP_BOUNDS.maxLat)) {
        throw new Error(
            `Extracted bounds ${header.minLon},${header.minLat},${header.maxLon},${header.maxLat} did not match ${getBasemapBoundingBox()}`,
        );
    }
}

async function extractBasemap(pmtilesBinaryPath: string, sourceUrl: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.promises.rm(TEMP_OUTPUT_PATH, { force: true });

    await execFileAsync(pmtilesBinaryPath, [
        "extract",
        sourceUrl,
        TEMP_OUTPUT_PATH,
        `--bbox=${getBasemapBoundingBox()}`,
        `--maxzoom=${BASEMAP_MAX_ZOOM}`,
        `--download-threads=${DEFAULT_DOWNLOAD_THREADS}`,
        `--overfetch=${DEFAULT_OVERFETCH}`,
    ], {
        maxBuffer: 1024 * 1024 * 16,
    });

    await verifyOutput(TEMP_OUTPUT_PATH);
    await fs.promises.rename(TEMP_OUTPUT_PATH, OUTPUT_PATH);
}

async function main(): Promise<void> {
    if (process.argv.includes("--help")) {
        printUsage();
        return;
    }

    const flags = parseFlags(process.argv.slice(2));
    const { buildKey, sourceUrl } = await resolveSourceUrl();

    console.log(`Basemap source: ${sourceUrl}`);
    console.log(`Clipping bbox: ${getBasemapBoundingBox()}`);
    console.log(`Max zoom: ${BASEMAP_MAX_ZOOM}`);
    console.log(`Output: ${OUTPUT_PATH}`);

    if (flags.dryRun) {
        console.log("Dry run only. No files were downloaded or modified.");
        return;
    }

    const pmtilesBinaryPath = await ensureGoPmtilesBinary();
    console.log(`Using go-pmtiles ${GO_PMTILES_VERSION} from ${pmtilesBinaryPath}`);

    await extractBasemap(pmtilesBinaryPath, sourceUrl);

    const finalStats = await fs.promises.stat(OUTPUT_PATH);
    console.log(`Saved ${BASEMAP_FILENAME} from ${buildKey} (${finalStats.size} bytes).`);
}

void main().catch(async (error) => {
    await fs.promises.rm(TEMP_OUTPUT_PATH, { force: true }).catch(() => undefined);
    console.error("Basemap regeneration failed:", error);
    process.exit(1);
});
