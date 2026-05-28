import * as path from "path";
import pino from "pino";
import * as fs from "fs";
import express from "express";
import { BASEMAP_FILENAME } from "./basemap";
import { GeocodedResult } from "./types";

const log = pino();
const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = __dirname;
const outputFile = path.join(__dirname, "../output.json");
const projectsFile = path.join(__dirname, "../projects.json");

let sites = new Array<GeocodedResult>();
let reloadTimer: NodeJS.Timeout | undefined;

async function loadSites(): Promise<void> {
    try {
        if (!fs.existsSync(outputFile)) {
            sites = [];
            log.warn({ path: outputFile }, "Data file not found. Starting with an empty site list.");
            return;
        }

        const fileContents = await fs.promises.readFile(outputFile, "utf8");
        sites = JSON.parse(fileContents) as GeocodedResult[];
        log.info({ count: sites.length }, "Loaded site data");
    } catch (error) {
        log.error({ err: error, path: outputFile }, "Error reading data file");
    }
}

function watchSitesFile(): void {
    if (!fs.existsSync(outputFile)) {
        return;
    }

    fs.watch(outputFile, () => {
        if (reloadTimer) {
            clearTimeout(reloadTimer);
        }

        // Delay slightly so we don't read the file mid-write.
        reloadTimer = setTimeout(() => {
            void loadSites();
        }, 250);
    });
}

app.use((req, res, next) => {
    log.info({ method: req.method, url: req.url }, "request");
    next();
});

app.use("/css", express.static(path.join(distDir, "css")));
app.use("/js", express.static(path.join(distDir, "js")));
app.use("/fonts", express.static(path.join(distDir, "fonts")));

app.get(`/${BASEMAP_FILENAME}`, (_req, res) => {
    res.sendFile(path.join(distDir, BASEMAP_FILENAME));
});

app.get("/sw.js", (_req, res) => {
    res.sendFile(path.join(distDir, "sw.js"));
});

app.get("/favicon.svg", (_req, res) => {
    res.sendFile(path.join(distDir, "favicon.svg"));
});

app.get("/output.json", (_req, res) => {
    res.json(sites);
});

app.get("/projects.json", (_req, res) => {
    res.sendFile(projectsFile);
});

app.get("/projects.json.gz", (_req, res) => {
    res.type("application/gzip").sendFile(path.join(distDir, "projects.json.gz"));
});

app.get("/", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
});

app.get("/all_sites", (_req, res) => {
    res.json(sites);
});

async function main(): Promise<void> {
    await loadSites();
    watchSitesFile();

    app.listen(port, "0.0.0.0", () => {
        log.info({ port }, "Server is listening");
    });
}

void main();
