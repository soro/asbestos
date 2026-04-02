Asbestos Remediations NYS
=========================

Scrapes and displays active asbestos remediation projects across New York State.

The production site is a static GitHub Pages deployment. Scraping and geocoding happen in GitHub Actions on a schedule; the browser only downloads static assets and the prebuilt dataset.

Live site: <https://soro.github.io/asbestos/>

## Project Layout

- `src/scrape.ts`: Playwright scraper for the NY Department of Labor report.
- `src/geocode.ts`: Runs the geocoding pipeline with configurable provider order and fallback.
- `src/app.ts`: Express server for the built frontend and live data reloads.
- `src/site/site.ts`: MapLibre client for the searchable map UI.
- `output.json`: Current geocoded project dataset used by the site.

## Local Usage

```bash
npm ci
npm run build
npm run build:full
npm start
```

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
