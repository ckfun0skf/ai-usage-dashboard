# AI Usage Dashboard

A browser-only analytics dashboard for understanding where AI token usage is going and when it happens.

## MVP

- Dedicated Import page with Model Provider and File Format selectors. Grok + CSV are selected by default.
- Drag and drop a Grok Usage CSV or click the drop area to open the system file chooser. Import starts automatically.
- Dashboard KPIs for total tokens, usage events, input, output and cached tokens.
- Daily token trend with selectable metrics and point details.
- Usage-type pie chart with exact token counts and percentage share.
- Product usage ranking; select a product to inspect its totals by usage type, model and day.
- Searchable usage records and CSV export for the selected date range.
- Repeated imports accumulate in IndexedDB. Older records remain and duplicate event IDs are skipped.

## Privacy and storage

- CSV parsing and analytics run in the browser. Imported records are stored in IndexedDB on this device.
- No application server, backend API, or server-side database is used.
- Clearing browser site data removes the saved dataset. Use a browser profile you trust if the CSV contains sensitive usage information.

## Adapter architecture

The app consumes normalized usage events. Add another provider or format by implementing an adapter with `id`, `label`, `supports(fileName, headerText)`, and `parse(text)` in `src/adapters/`, then register it in the adapter list. Normalized events include `product`, `model`, `usageType`, `timestamp`, token counts, cost and currency. Give every event a stable unique `id` for deduplication.

## Run locally

Because this app uses JavaScript ES modules, serve the folder with any static file server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. For GitHub Pages without Actions, configure **Settings → Pages → Deploy from a branch → main → /(root)**.

## Supported Grok CSV

The first adapter expects `Event Time`, `Product`, and `Usage` columns. The `Usage` field contains JSON fields such as `prompt-text-tokens`, `completion-text-tokens`, `cached-prompt-text-tokens`, and `cache-write-text-tokens`. Product values are retained so the dashboard can group usage by product.


## User and model analytics

- A model registry-style presentation gives each model a local icon and label, with a generic fallback for future providers.
- If the Grok export includes `User Email`, the dashboard ranks users by tokens and shows their top product and usage type. Selecting a user opens a breakdown by usage type, product and day.
- Email masking is available for screen sharing. Email values remain in the browser's local IndexedDB with the imported events; there is no server upload. CSV export includes the User Email field when present.
