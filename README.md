Asbestos Remediations NYC
=========================

Scrapes active asbestos remediation projects across New York State and displays the NYC-area projects on a searchable map.

The production site is a static GitHub Pages deployment. Scraping and geocoding happen in GitHub Actions on a schedule; the browser only downloads static assets and the prebuilt dataset.

Live site: <https://soro.github.io/asbestos/>

The PMTiles basemap is intentionally stored as `new-york.pmtiles.gz`. This is a GitHub Pages workaround for Firefox range-request failures caused by automatic compression of `.pmtiles` responses. The file contents are still a normal PMTiles archive; only the filename is changed so Pages serves raw byte ranges more reliably.

The interface self-hosts Clarity City webfonts from VMware's archived Clarity City project. The font files are distributed under the SIL Open Font License, included at `src/static/fonts/clarity-city/OFL.txt`.

## Project Layout

- `src/scrape.ts`: Playwright scraper for the NY Department of Labor report.
- `src/geocode.ts`: Runs the geocoding pipeline with configurable provider order and fallback.
- `src/update-basemap.ts`: Rebuilds the clipped Protomaps basemap archive used by the site.
- `src/app.ts`: Express server for the built frontend and live data reloads.
- `src/site/site.ts`: MapLibre client for the searchable map UI.
- `output.json`: Current geocoded project dataset used by the site. The browser filters this statewide dataset to the configured NYC map bounds.

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
```

`npm run geocode` reuses `geocode_cache.json`, and now also seeds that cache from the existing `output.json`, so previously geocoded addresses do not need to be looked up again during the nightly action.

The geocoding pipeline supports ordered fallback through `GEOCODER_PROVIDER_ORDER`. It currently defaults to `census`, but the code also includes a disabled NYS provider so the action can later switch to `nys,census` without another refactor.

```bash
GEOCODER_PROVIDER_ORDER=nys,census npm run geocode
```

The NYS provider uses `NYS_GEOCODER_URL` if you need to override the future production endpoint during testing.

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
