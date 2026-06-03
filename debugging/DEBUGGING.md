# Debugging scripts

Retained helpers for the things we otherwise keep rebuilding as throwaway
scripts — eyeballing an OG card after a template/title change, and inspecting
what a single event actually contains. They read the **live** `alerts.json` by
default, so you don't need a local build or a fresh `npm run build` to use them.

Outputs default to `tmp/` (gitignored). Run everything from the repo root.

| Script | What it does |
| --- | --- |
| `render-og.js` | Render one event's OG card (1200×630 PNG) for visual review. |
| `inspect-event.js` | Print one event's wire JSON, or the strings the UI derives from it. |

---

## `render-og.js`

Renders a single event's Open Graph card to a PNG through the **exact**
production path — it imports `accentFor` / `summarize` / `fillTemplate` /
`renderPng` from `scripts/prerender-events.js`, so the sample is byte-faithful
to what the build emits. Change `scripts/og-event-template.html` or the title
logic, render one card, look at it.

```sh
node debugging/render-og.js --id 3mndpmuotdx2m
node debugging/render-og.js --id 3mndpmuotdx2m --variant resolved
node debugging/render-og.js --id 3mndpmuotdx2m --out tmp/card.png
node debugging/render-og.js --id 3mndpmuotdx2m --data public/data/alerts.json
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--id` | *(required)* | The rkey at the end of an `/event/<id>/` URL. |
| `--variant` | `canonical` | `resolved` forces the `Archived` badge (the Bluesky-card-cache variant). |
| `--out` | `tmp/og-<id>.png` | Output PNG path. |
| `--data` | live `alerts.json` | Local snapshot instead (e.g. `public/data/alerts.json`). |

Requires Playwright's chromium (already a dev dependency; `npx playwright
install chromium` if it's missing).

### Why it imports from the build script

The card render lives in `scripts/prerender-events.js`. Rather than duplicate
the template-fill + screenshot here (which silently drifts the moment the real
card changes), that file exports its render helpers and only runs its build
`main()` when invoked directly. Keep it that way — a debug card that lies is
worse than no debug card.

## `inspect-event.js`

Print one event's data, or the derived UI strings, without opening the SPA.

```sh
# Full incident JSON (the nested wire shape the app reads):
node debugging/inspect-event.js --id 3mndpmuotdx2m

# Just the derived strings — title, bot summary, source, line/route:
node debugging/inspect-event.js --id 3mndpmuotdx2m --titles

# From a local snapshot instead of live:
node debugging/inspect-event.js --id 3mndpmuotdx2m --data public/data/alerts.json
```

The `--titles` output uses the same pure helpers the app does
(`lib/incidents.js`, `lib/stations.js`). The in-app title mirrors `describeText`
in `components/event/incidentText.jsx` — a `.jsx` file the renderers can't
import — so if that function changes, update the small `inAppTitle` mirror here.

---

## Notes & gotchas

- **The frontend is a dumb client.** If an event's data looks wrong (missing
  stations, wrong title input), the fix belongs upstream in `cta-insights`'s
  export, not here. These tools are for *seeing* the data, not patching it.
- **OG cards are rebuilt for every event on each deploy** — the per-card cache
  signature includes a hash of `og-event-template.html`, so any template change
  busts the whole cache. A local `render-og.js` preview is just to avoid a full
  build while iterating.
- **Live vs. local data.** Default is the public production feed (always
  current). Use `--data <path>` for a frozen local snapshot or an unshipped
  export change. Forks can point at a different deploy with the `CTA_DATA_URL`
  env var (e.g. `CTA_DATA_URL=https://example.test/data/alerts.json`).
