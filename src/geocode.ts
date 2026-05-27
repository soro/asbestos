import * as fs from "fs";
import * as path from "path";
import { SearchResult } from "./types";
import { geocodeSites } from "./geocoding";

const RAW_OUTPUT = path.join(__dirname, "../raw_output.json");
const OUTPUT = path.join(__dirname, "../output.json");

async function main(): Promise<void> {
    if (!fs.existsSync(RAW_OUTPUT)) {
        console.error("No raw output found. Run scraper first.");
        process.exit(1);
    }

    const rawData: SearchResult[] = JSON.parse(fs.readFileSync(RAW_OUTPUT, "utf8"));
    const geocodedData = await geocodeSites(rawData);

    fs.writeFileSync(OUTPUT, JSON.stringify(geocodedData, null, 2));
    console.log(`Saved ${geocodedData.length} items to ${OUTPUT}`);
}

main();
