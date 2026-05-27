Asbestos Remediations NYC
=========================

Scrapes active asbestos remediation projects across New York State and displays the NYC-area projects on a searchable map.

The production site is a static GitHub Pages deployment. Scraping and geocoding happen in GitHub Actions on a schedule; the browser only downloads static assets and the prebuilt dataset.

Live site: <https://soro.github.io/asbestos/>

The PMTiles basemap is intentionally stored as `new-york.pmtiles.gz`. This is a GitHub Pages workaround for Firefox range-request failures caused by automatic compression of `.pmtiles` responses. The file contents are still a normal PMTiles archive; only the filename is changed so Pages serves raw byte ranges more reliably.

The interface self-hosts Clarity City webfonts from VMware's archived Clarity City project. The font files are distributed under the SIL Open Font License, included at `src/static/fonts/clarity-city/OFL.txt`.

## Project Layout

- `src/scrape.ts`: Playwright scraper for the NY Department of Labor report.
- `src/fetch-acp7.ts`: Fetches current NYC DEP ACP7 asbestos notification records from NYC Open Data.
- `src/geocode.ts`: Runs the geocoding pipeline with configurable provider order and fallback.
- `src/geocoding.ts`: Shared geocoding/cache utilities used by both data sources.
- `src/build-projects.ts`: Builds the normalized merged project dataset.
- `src/update-basemap.ts`: Rebuilds the clipped Protomaps basemap archive used by the site.
- `src/app.ts`: Express server for the built frontend and live data reloads.
- `src/site/site.ts`: MapLibre client for the searchable map UI.
- `output.json`: Current geocoded project dataset used by the site. The browser filters this statewide dataset to the configured NYC map bounds.
- `acp7_output.json`: Current NYC DEP ACP7 projects, aggregated to one project per `TRU`.
- `projects.json`: Normalized merged dataset containing NYS DOL projects and NYC DEP ACP7 projects.

The downloadable `output.json` contains both resolved and unresolved projects in one flat array. Resolved projects include numeric `lat` and `lng` fields; unresolved projects are kept in the file without those coordinate fields.

The normalized `projects.json` keeps source records under each project's `sources` array. NYS DOL and ACP7 records are merged only when contractor, normalized street address, start date, and end date all match. Projects at the same address otherwise remain separate records and share an `addressKey`, so the UI can later show multiple projects at one location without collapsing distinct work.

## Local Usage

```bash
npm ci
npm run build
npm run build:full
npm start
```

- Node.js 24 or newer is the supported runtime for local development and GitHub Actions.
- `npm run build`: builds the static GitHub Pages artifact in `dist/`.
- `npm run build:full`: builds the static site plus the local Node tools/server.

## Data Refresh

```bash
npm run build:node
npm run scrape
npm run geocode
npm run fetch-acp7
npm run build-projects-data
```

`npm run geocode` reuses `geocode_cache.json`, and now also seeds that cache from the existing `output.json`, so previously geocoded addresses do not need to be looked up again during the nightly action. It also writes `geocode_failure_cache.json` for addresses that still fail after every configured provider, so repeated runs do not retry permanent failures unless the provider order or cache version changes.

The geocoding pipeline supports ordered fallback through `GEOCODER_PROVIDER_ORDER`. It defaults to the production NYS Geocoder, then Census, then Nominatim as the final fallback for the small set of addresses and place descriptions the government geocoders cannot resolve.

```bash
GEOCODER_PROVIDER_ORDER=nys,census,nominatim npm run geocode
```

The NYS provider uses `NYS_GEOCODER_URL` if you need to override the production endpoint during testing. The Nominatim provider uses `NOMINATIM_GEOCODER_URL`, `NOMINATIM_USER_AGENT`, and `NOMINATIM_REQUEST_DELAY_MS` for endpoint, contact header, and rate-limit tuning.

`npm run fetch-acp7` uses the NYC Open Data Socrata/SODA JSON API for the DEP "Asbestos Control Program (ACP7)" dataset. By default it fetches `Submitted` records with `end_date` on or after the current date and groups the source rows by `TRU`.

Useful overrides:

```bash
ACP7_ACTIVE_DATE=2026-05-27 npm run fetch-acp7
ACP7_API_URL=https://data.cityofnewyork.us/resource/vq35-j9qm.json npm run fetch-acp7
SOCRATA_APP_TOKEN=... npm run fetch-acp7
```

ACP7 records with native `LATITUDE`/`LONGITUDE` use those coordinates. If an ACP7 project has no native coordinates but does have a street address, the same configured geocoder chain is used as a fallback. Records without a street address are kept unresolved rather than being geocoded to a ZIP-level point.

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
