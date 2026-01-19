import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, Page, Frame } from "playwright";
import { SearchResult } from "./types";

let interceptedBatches: SearchResult[][] = [];
let interceptionResolve: ((value?: any) => void) | null = null;

function parseDispResponse(text: string): SearchResult[] {
    const results: SearchResult[] = [];
    
    // Regex to find addContextData with dynamic namespace
    const match = text.match(/window\.oCVSC_.*?\.addContextData\(\s*(\{[\s\S]*?\})\s*\);/);
    if (!match) {
        console.log("No addContextData match found in text (regex failed).");
        return [];
    }

    try {
        const jsonStr = match[1];
        const data = JSON.parse(jsonStr);
        
        // Convert to array and sort by key
        const items = Object.keys(data).map(k => ({ k: parseInt(k), v: data[k] })).sort((a, b) => a.k - b.k);
        
        let currentRow: any = {};
        
        for (const item of items) {
            const val = item.v;
            
            if (!val.u) continue; // Skip if no value

            // Heuristic to skip headers: check if value equals column name
            if (val.r === 2 && val.u === "CONTRACTOR") continue;
            
            if (val.r === 2) currentRow.contractor = val.u;
            if (val.r === 3) console.log(`Column 3 (potential county?): ${val.u}`);
            if (val.r === 4) currentRow.start = val.u;
            if (val.r === 6) currentRow.end = val.u;
            if (val.r === 8) currentRow.street = val.u;
            if (val.r === 10) currentRow.city = val.u;
            if (val.r === 12) currentRow.zip = val.u;
            if (val.r === 13) console.log(`Column 13 (potential county?): ${val.u}`);
            
            if (val.r === 14) { // Last column (Case Reference)
                 if (currentRow.contractor) {
                     results.push(currentRow as SearchResult);
                 }
                 currentRow = {};
            }
        }
        console.log(`Extracted ${results.length} rows from JSON.`);
    } catch (e) {
        console.error("Error parsing DISP JSON:", e);
    }
    return results;
}

async function fullCrawl(browser: Browser): Promise<SearchResult[]> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const baseUrl = "https://biservices.labor.ny.gov/Reports/bi/?perspective=classicviewer&pathRef=.public_folders%2FWPS%2BReports%2FActive%2BAsbestos%2BProjects&id=i54BC6F1D21F74795A7CA53A0D31798A5&ui_appbar=false&ui_navbar=false&objRef=i54BC6F1D21F74795A7CA53A0D31798A5&action=run&format=HTML&cmPropStr=%7B%22id%22%3A%22i54BC6F1D21F74795A7CA53A0D31798A5%22%2C%22type%22%3A%22report%22%2C%22defaultName%22%3A%22Active%20Asbestos%20Projects%22%2C%22permissions%22%3A%5B%22execute%22%2C%22read%22%2C%22traverse%22%5D%7D";

    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("v1/disp") && response.status() === 200) {
            try {
                const text = await response.text();
                if (text.includes("addContextData")) {
                    console.log("Intercepted data response.");
                    const batch = parseDispResponse(text);
                    if (batch.length > 0) {
                        console.log(`Parsed ${batch.length} rows.`);
                        interceptedBatches.push(batch);
                        if (interceptionResolve) {
                            interceptionResolve();
                            interceptionResolve = null;
                        }
                    }
                }
            } catch (e) { }
        }
    });

    console.log("Navigating...");
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    const allResults: SearchResult[] = [];
    let hasNextPage = true;
    let pageCount = 0;

    console.log("Waiting for initial data...");
    await new Promise<void>(resolve => {
        if (interceptedBatches.length > 0) resolve();
        else interceptionResolve = resolve;
    });

    while (hasNextPage) {
        while (interceptedBatches.length > 0) {
            const batch = interceptedBatches.shift()!;
            allResults.push(...batch);
        }
        pageCount++;
        console.log(`Page ${pageCount} processed. Total rows: ${allResults.length}`);
        
        // Save intermediate results
        fs.writeFileSync(path.join(__dirname, "../raw_output.json"), JSON.stringify(allResults, null, 2));

        console.log("Waiting for UI to render navigation (10s)...");
        await page.waitForTimeout(10000);

        // Try to find "Page down" button across ALL frames
        const frames = page.frames();
        let pageDown: any = null;
        let foundFrame: Frame | null = null;

        console.log(`Checking ${frames.length} frames for 'Page down' button...`);
        for (const f of frames) {
            console.log(`- Frame "${f.name()}" URL: ${f.url().substring(0, 60)}...`);
            try {
                const pd = f.locator("a[title*='Page down'], img[alt*='Page down'], img[title*='Page down'], a:has-text('Page down')").first();
                if (await pd.count() > 0 && await pd.isVisible()) {
                    pageDown = pd;
                    foundFrame = f;
                    console.log(`Found 'Page down' in frame: ${f.url().substring(0, 50)}...`);
                    break;
                }
            } catch (e) { }
        }

        if (pageDown && foundFrame) {
            try {
                const src = await pageDown.getAttribute("src");
                if (src && src.includes("_dis")) {
                    console.log("Page down disabled (image src contains _dis). End of report.");
                    hasNextPage = false;
                } else {
                    console.log("Clicking Page down...");
                    const p = new Promise<void>(resolve => interceptionResolve = resolve);
                    await pageDown.click();
                    console.log("Waiting for next data batch...");
                    const timeout = new Promise<void>(resolve => setTimeout(() => {
                        console.log("Timeout waiting for next page data.");
                        resolve(); 
                    }, 30000));
                    
                    await Promise.race([p, timeout]);
                    
                    if (interceptedBatches.length === 0) {
                        console.log("No new data received after click. Assuming end.");
                        hasNextPage = false;
                    }
                }
            } catch (e) {
                console.log("Error during navigation click:", e);
                hasNextPage = false;
            }
        } else {
            console.log("Page down button not found in any frame.");
            // Debug: log frame contents summary
            for (const f of frames) {
                const html = await f.content();
                console.log(`- Frame ${f.name()} (${f.url().substring(0, 30)}): html len ${html.length}`);
                if (html.includes("Page down")) console.log(`  [!] Frame contains 'Page down' text`);
            }
            hasNextPage = false;
        }
    }

    return allResults;
}

async function main(): Promise<void> {
    console.log("Launching browser...");
    const browser = await chromium.launch({ 
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    });
    
    try {
        console.log("Crawling...");
        const CRAWL_TIMEOUT = 1800000; // 30 minutes
        
        const results = await Promise.race([
            fullCrawl(browser),
            new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(new Error("Global timeout exceeded")), CRAWL_TIMEOUT))
        ]);
        
        console.log(`Found ${results.length} total results.`);
        
        const fp = path.join(__dirname, "../raw_output.json");
        fs.writeFileSync(fp, JSON.stringify(results, null, 2));
        console.log(`Saved results to ${fp}`);
    } catch (e) {
        console.error("Error during crawl:", e);
        process.exit(1);
    } finally {
        await browser.close();
        process.exit(0);
    }
}

main();