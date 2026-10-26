# AI Usage Dashboard

A small, browser-only analytics dashboard with a Dynatrace-inspired observability layout.

## MVP scope

- Import a Grok Usage CSV export.
- Parse the JSON in the `Usage` column into prompt, completion, cached prompt, and cache-write token metrics.
- Explore token totals over a selectable time range, an adaptive time-series chart, token composition, and individual events.
- Search events and export the current time-range view to CSV.
- Persist the most recently imported dataset in this browser using IndexedDB.

## Privacy and storage

- CSV parsing and analytics run in the browser.
- The imported dataset is saved in this browser's IndexedDB. It is not uploaded to an application server.
- There is no server-side database or backend API.
- The app does not load charting libraries or fonts from a CDN; visualizations use native Canvas and CSS.
- Browser site-data clearing removes the saved dataset. Use a browser profile you trust if the CSV contains sensitive usage information.

## Architecture: adapter-based ingestion

```text
src/
  core/csv.js                 Generic CSV parser
  adapters/grok-usage-csv.js  Grok CSV validation + normalization
  storage/usage-store.js      Browser IndexedDB persistence
  app.js                      UI, filtering, aggregation, charts
```

The ingestion boundary is intentionally modular. To add another provider or file format:

1. Create an adapter under `src/adapters/` implementing `id`, `label`, `supports(fileName, headerText)`, and `parse(text)`.
2. Return normalized events with `timestamp`, `model`, `prompt`, `completion`, `cached`, `cacheWrite`, `total`, `usageType`, `cost`, and `currency`.
3. Register the adapter in `usageAdapters` in `src/adapters/grok-usage-csv.js` (this registry can be moved into its own module as more adapters are added).

The UI and charts consume normalized events rather than provider-specific columns.

## Run locally

Because this app uses JavaScript ES modules, serve the folder with any static file server. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. GitHub Pages deployment is configured in `.github/workflows/pages.yml`.

## Supported input

The first adapter expects a CSV with `Event Time`, `Product`, and `Usage` columns. `Usage` must contain JSON token fields such as:

- `prompt-text-tokens`
- `completion-text-tokens`
- `cached-prompt-text-tokens`
- `cache-write-text-tokens`

Rows for products other than `grok-bot` are ignored. Missing `Model` values are shown as `Grok (unspecified)`.
