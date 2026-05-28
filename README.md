Asbestos Remediations NYC
=========================

A searchable map of active asbestos remediation projects in New York City.

This project combines public asbestos project data from the New York State Department of Labor and the New York City Department of Environmental Protection, then normalizes, geocodes, and publishes it as a static dataset and map.

The goal is to make asbestos remediation information easier to inspect for residents, workers, tenant organizers, journalists, and anyone else trying to understand active work near an address or neighborhood. The source data is public, but it is spread across government systems and is not especially convenient to search spatially. This project makes that data easier to browse, download, and compare while preserving source records.

Live site: <https://soro.github.io/asbestos/>

## Data Sources

The primary source is the NYS Department of Labor "Active Asbestos Projects" report. It provides the statewide active-project feed, including contractor, start date, end date, address, ZIP, and DOL case reference. The scraper uses Playwright to load the public BI report hosted by `biservices.labor.ny.gov` and page through all rows. The full report URL is kept in `src/scrape.ts`.

The secondary source is the NYC DEP "Asbestos Control Program (ACP7)" dataset from NYC Open Data. It is fetched through the Socrata/SODA JSON endpoint at `https://data.cityofnewyork.us/resource/vq35-j9qm.json`. ACP7 adds NYC-specific notification details, including TRU, status, facility information, owner, air monitor, BBL, NTA, community board, council district, and material details.

DOL is treated as the primary source for project identity because it is the statewide active-project report and includes the DOL case reference. DEP ACP7 is used to add NYC-specific records and enrich matching DOL records with more detailed local information.

## Data Model

The main public dataset is `projects.json`. It is used by the frontend and by the download link in the application.

Each normalized project contains:

- `id`: stable source-derived project id, such as `nys_dol:27123456` or `nyc_dep_acp7:TRU...`.
- `title` and `contractor`: display labels.
- `start` and `end`: normalized ISO dates.
- `address`: normalized address plus optional NYC metadata such as BBL, NTA, community board, and council district.
- `addressKey`: normalized location key used to find multiple projects at one address.
- `coordinates`: optional `{ lat, lng, source, provider }` object.
- `sources`: original source records from DOL, DEP ACP7, or both.

Resolved and unresolved projects are kept in the same dataset. Projects without coordinates remain downloadable but are not shown as map markers.

Generated data files:

- `raw_output.json`: ignored intermediate NYS DOL scrape output for debugging scraper runs.
- `output.json`: geocoded NYS DOL feed and input to the normalized build.
- `acp7_output.json`: NYC DEP ACP7 feed normalized to one project per `TRU`.
- `projects.json`: merged normalized dataset used by the site.
- `geocode_cache.json`: persistent cache of successful geocoder lookups.
- `geocode_failure_cache.json`: persistent cache of addresses that failed all configured geocoders.

## Merge Policy

Merging is intentionally conservative.

A DEP ACP7 record is merged into a DOL project only when contractor, normalized street address, start date, and end date all match. When that happens, the DOL project remains the primary record and ACP7 is attached as an additional source. This preserves the DOL case reference while adding NYC-specific fields from DEP.

Projects are not merged merely because they share an address or coordinates. Multiple projects at the same address remain separate records and are shown as a list in the popup.

## Geocoding

The geocoding pipeline tries providers in this order:

1. NYS Geocoder
2. US Census Geocoder
3. Nominatim

Nominatim is only a final fallback for records that cannot be resolved by the government geocoders. The implementation rate-limits Nominatim requests, sends a contact user agent, and restricts accepted results to the US/New York area.

Successful geocoding attempts are cached in `geocode_cache.json`. Addresses that fail every configured provider without a provider error are cached in `geocode_failure_cache.json`, so scheduled refreshes do not repeatedly retry permanent failures. Failure cache entries are tied to the provider order and cache version, so changing the geocoder chain can retry old failures.

ACP7 records with native latitude and longitude use those coordinates first. ACP7 records without a street address are kept unresolved rather than being geocoded to a coarse ZIP-level point.

Useful geocoder overrides:

```bash
GEOCODER_PROVIDER_ORDER=nys,census,nominatim npm run geocode
NYS_GEOCODER_URL=... npm run geocode
NOMINATIM_GEOCODER_URL=... npm run geocode
NOMINATIM_USER_AGENT=... npm run geocode
NOMINATIM_REQUEST_DELAY_MS=1500 npm run geocode
```

## Display Decisions

The frontend renders one feature per project once normal marker zoom is reached, even when projects share coordinates. Low zoom levels use MapLibre clustering as a visual aggregation layer, but clustering is not treated as a data merge.

Single-project popups use a flat layout. Locations with multiple projects show a list. ACP7 extended fields are collapsed by default so common fields such as Start, End, Case, TRU, and Status stay easy to scan.

## Technical Architecture

The production site is static and deployed to GitHub Pages. Data refreshes run in GitHub Actions on a schedule. The browser downloads static assets, `projects.json`, and a local PMTiles basemap.

The static build leaves the committed `projects.json` readable for data diffs, then minifies `dist/projects.json` and emits `dist/projects.json.gz`. The frontend tries the gzip payload first with the browser's native decompression stream and falls back to plain `projects.json` when that is unavailable.

The scheduled data workflow runs:

```text
build:node -> scrape -> geocode -> fetch-acp7 -> build-projects-data
```

When generated data changes, the workflow commits updated `output.json`, `acp7_output.json`, `projects.json`, `geocode_cache.json`, and `geocode_failure_cache.json`. The deploy workflow then builds the static site from the committed data.

The PMTiles basemap is intentionally stored as `new-york.pmtiles.gz`. This is a GitHub Pages workaround for Firefox range-request failures caused by automatic compression of `.pmtiles` responses. The file contents are still a normal PMTiles archive; only the filename is changed so Pages serves raw byte ranges more reliably.

The interface self-hosts Clarity City webfonts from VMware's archived Clarity City project. The font files are distributed under the SIL Open Font License, included at `src/static/fonts/clarity-city/OFL.txt`.

## Project Layout

- `src/scrape.ts`: Playwright scraper for the NYS DOL report.
- `src/fetch-acp7.ts`: Fetches and groups NYC DEP ACP7 records from NYC Open Data.
- `src/geocode.ts`: Geocodes the NYS DOL output.
- `src/geocoding.ts`: Shared geocoding and cache utilities.
- `src/build-projects.ts`: Builds `projects.json` from DOL and ACP7 inputs.
- `src/update-basemap.ts`: Rebuilds the clipped Protomaps basemap archive.
- `src/app.ts`: Express server for local development and static file serving.
- `src/site/site.ts`: MapLibre client for the searchable map UI.

## Local Development

```bash
npm ci
npm run build
npm run build:full
npm start
```

Node.js 24 or newer is the supported runtime for local development and GitHub Actions.

- `npm run build`: builds the static GitHub Pages artifact in `dist/`.
- `npm run build:full`: builds the static site plus the local Node tools/server.
- `npm start`: builds and starts the local Express server.

## Data Refresh

Run the full refresh locally with:

```bash
npm run refresh-data
```

Or run the stages manually:

```bash
npm run build:node
npm run scrape
npm run geocode
npm run fetch-acp7
npm run build-projects-data
```

ACP7 fetch overrides:

```bash
ACP7_ACTIVE_DATE=YYYY-MM-DD npm run fetch-acp7
ACP7_API_URL=https://data.cityofnewyork.us/resource/vq35-j9qm.json npm run fetch-acp7
SOCRATA_APP_TOKEN=... npm run fetch-acp7
```

By default `npm run fetch-acp7` fetches ACP7 records with `status_description = 'Submitted'` and `end_date` on or after the current date, then groups source rows by `TRU`.

## Basemap Refresh

```bash
npm run refresh-basemap
```

This rebuilds `src/static/new-york.pmtiles.gz` by:

- discovering the latest Protomaps daily build from `https://build-metadata.protomaps.dev/builds.json`
- extracting only the NYC-area bounding box `-74.3,40.49,-73.6,41.0`
- capping detail at `maxzoom=14` so the artifact stays under the GitHub Pages size target

Useful overrides:

```bash
npm run refresh-basemap -- --dry-run
PROTOMAPS_BUILD_KEY=20260313.pmtiles npm run refresh-basemap
```

The task downloads the official `go-pmtiles` CLI on demand and currently assumes standard `tar`/`unzip` tooling is available.
