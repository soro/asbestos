import * as path from "path";
import pino from "pino";
import * as fs from 'fs';
import express from "express";
import { GeocodedResult } from "./types";

const log = pino();
const app = express();
const port = 3000;

console.log("Server running in:", __dirname);

let sites = new Array<GeocodedResult>();

const fp = path.join(__dirname, "../output.json");
try {
    if (fs.existsSync(fp)) {
        sites = JSON.parse(fs.readFileSync(fp, "utf8"));
    } else {
        log.warn(`Data file not found at ${fp}. Starting with empty site list.`);
    }
} catch (e) {
    log.error(`Error reading data file: ${e}`);
}

async function readFile(fileName: fs.PathLike): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(fileName, { encoding: "utf8" }, (err, data) => {
            if (err) { reject(err); } else { resolve(data); }
        });
    });
}

async function statFile(fileName: fs.PathLike): Promise<fs.Stats> {
    return new Promise((resolve, reject) => {
        fs.stat(fileName, (err, stats) => {
            if (err) { reject(err); } else { resolve(stats); }
        });
    });
}

async function loadSites(p: fs.PathLike): Promise<GeocodedResult[]> {
    return readFile(p).then(JSON.parse);
}

if (fs.existsSync(fp)) {
    fs.watch(fp, (event, name) => {
        if (name) {
            statFile(fp).then((stats) => {
                if (stats.size > 0) {
                    loadSites(fp).then((newSites) => { sites = newSites; });
                }
            });
        }
    });
}

app.use((req, res, next) => {
    console.log(`Request: ${req.method} ${req.url}`);
    next();
});

app.use("/css", express.static(path.join(__dirname, "../src/static")));
app.use("/js", express.static(path.join(__dirname, "../dist/js")));

// Serve PMTiles and Service Worker from the current directory (dist)
app.get("/new-york.pmtiles", (req, res) => {
    res.sendFile(path.join(__dirname, "new-york.pmtiles"));
});

app.get("/sw.js", (req, res) => {
    res.sendFile(path.join(__dirname, "sw.js"));
});

app.get("/output.json", (req, res) => {
    const file = path.join(__dirname, "../output.json");
    if (fs.existsSync(file)) {
        res.sendFile(file);
    } else {
        res.status(404).send("Data file not found");
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/all_sites", (req, res) => {
    res.send(sites);
});

app.listen(port, "0.0.0.0", (err) => {
    if (err) {
        return log.error(err);
    }
    return log.info(`server is listening on ${port}`);
});
