import * as fs from "fs";
import * as path from "path";
import { SearchResult, GeocodedResult } from "./types";

const RAW_OUTPUT = path.join(__dirname, "../raw_output.json");
const OUTPUT = path.join(__dirname, "../output.json");
const CACHE_FILE = path.join(__dirname, "../geocode_cache.json");

let cache: Record<string, { lat: number, lng: number }> = {};

if (fs.existsSync(CACHE_FILE)) {
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch (e) {
        console.log("Error reading cache, starting fresh.");
    }
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
    if (cache[address]) {
        return cache[address];
    }

    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    try {
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json() as any;
        const matches = data.result?.addressMatches;
        
        if (Array.isArray(matches) && matches.length > 0) {
            const coords = matches[0].coordinates;
            const result = {
                lat: coords.y,
                lng: coords.x
            };
            cache[address] = result;
            return result;
        }
    } catch (e) {
        console.error(`Geocoding error for ${address}:`, e);
    }
    return null;
}

async function main() {
    if (!fs.existsSync(RAW_OUTPUT)) {
        console.error("No raw output found. Run scraper first.");
        process.exit(1);
    }

    const rawData: SearchResult[] = JSON.parse(fs.readFileSync(RAW_OUTPUT, "utf8"));
    const geocodedData: GeocodedResult[] = [];

    console.log(`Geocoding ${rawData.length} items...`);

    for (const item of rawData) {
        const address = `${item.street}, ${item.city}, ${item.zip}, NY`;
        
        // Check if we already have it in output (if merging) - for now just overwrite
        
        const coords = await geocodeAddress(address);
        if (coords) {
            console.log(`Geocoded: ${address}`);
            geocodedData.push({ ...item, ...coords });
        } else {
            console.log(`Failed to geocode: ${address}`);
            // Keep it without coords? Map won't show it.
            // Let's keep it so we don't lose data.
            geocodedData.push(item);
        }
        
        // Rate limit
        await new Promise(r => setTimeout(r, 100));
    }

    saveCache();
    fs.writeFileSync(OUTPUT, JSON.stringify(geocodedData, null, 2));
    console.log(`Saved ${geocodedData.length} items to ${OUTPUT}`);
}

main();
