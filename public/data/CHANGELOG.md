# Data API Changelog

Breaking and notable changes to the published data at
<https://chicagotransitalerts.app/data/> — `alerts.json` and `alerts.csv`.
Newest first. If you build on this data, watch this file before pinning to the
format.

## 2026-05-23 — Unified incident model (breaking)

`alerts.json` now publishes a single top-level **`incidents[]`** array,
replacing the previous separate `alerts[]` and `observations[]` arrays.

- Each incident is one real-world disruption. It pairs the official CTA alert
  (`cta`, `null` for bot-only incidents) with the bot observation(s) describing
  the same event (`observations[]`, empty for CTA-only incidents), plus a
  `sources` field listing which contributed (`"cta"`, `"bot"`, or both). The
  alert↔observation pairing that consumers previously had to do themselves now
  happens once, server-side.
- Train line keys are now **full names** (`red`, `blue`, `brown`, `green`,
  `orange`, `pink`, `purple`, `yellow`) instead of the CTA short codes
  (`g`, `org`, `brn`, `p`, `y`). Bus route numbers are unchanged.
- `alerts.csv` keeps the same columns, but `routes` values now use the full
  line names to match.

**Migrating from the old shape**

- Old `alerts[]` entries are now `incident.cta` (with the incident's
  `kind`/`routes` at the top level); old `observations[]` entries are now
  `incident.observations[]`. An incident's `sources` tells you whether it
  carries a CTA alert, bot observations, or both. See the
  [README "Data as an API"](https://github.com/cailinpitt/chicago-transit-alerts#data-as-an-api)
  section for the full shape.
- Map any hard-coded short line codes to full names.
