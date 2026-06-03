# Data API Changelog

Breaking and notable changes to the published data at
<https://chicagotransitalerts.app/data/> — `alerts.json` and `alerts.csv` — and
the syndication feeds at <https://chicagotransitalerts.app/feed.xml> (and the
per-line/route feeds under `/feed/`). Newest first. If you build on this data,
watch this file before pinning to the format.

## 2026-06-03 — Full impacted-station fill: `stations` / `affected_stations` (additive)

Disruptions that span a stretch of track ("Rockwell → Montrose") now publish
**every station on that stretch**, including the inner stops between the two
named endpoints — not just the endpoints themselves. Previously only the two
endpoint names were carried, so a station page for an inner stop (Western,
Damen) wouldn't surface an event that clearly ran through it.

- **Bot observations** — new field `incidents[].observations[].stations`: the
  ordered list of roster station names along the observed segment, from the
  `from_station` end to the `to_station` end, endpoints included. Omitted when
  the segment can't be enumerated (e.g. multi-signal roundups with no single
  stretch); consumers then fall back to `from_station` / `to_station`.
- **CTA alerts** — new field `incidents[].cta.affected_stations`: the same
  endpoint-inclusive fill for a "between X and Y" alert's affected segment,
  unioned across the alert's lines. Empty `[]` when there's no resolvable
  segment (single-station mentions still live in `mentioned_stations`).

The enumeration is geometry-derived from the already-published endpoints + line
data, so it is **backfilled across all historical incidents** on the next
export, not just new ones. `from_station` / `to_station` /
`affected_from_station` / `affected_to_station` / `mentioned_stations` are
unchanged, and `alerts.csv` is unaffected (it keeps its flat endpoint columns).
Consumers that ignore the new fields see no change.

## 2026-05-31 — `onset_description` + more accurate `onset_ts` (additive)

Two related changes to absence-style bot observations (`detection_source`
`pulse-cold` / `thin-gap`):

- **New field `onset_description`** — a pre-rendered sentence labelling the
  back-dated start of the gap (e.g. _"Last train observed through this stretch
  around here — the service gap began about now."_), for rendering a timeline
  entry at `onset_ts`. Omitted when there's no meaningful back-date (the start
  is within ~5 min of the post). Field at
  `incidents[].observations[].onset_description`.
- **More accurate `onset_ts`** — when the last vehicle through the stretch
  predated the detector's short lookback window, `onset_ts` previously floored
  to the cold threshold (a lower bound). It's now recovered from the wider 2h
  position history to the concrete last-seen vehicle, capped at 2h and guarded
  against crossing a scheduled no-service gap (so an early-morning detection
  isn't back-dated to the prior night's final train). `onset_ts` may therefore
  be earlier (more accurate) than before for these observations, and
  `duration_ms` moves with it. The field's meaning and shape are unchanged.

No fields were removed or renamed; consumers that ignore `onset_description`
are unaffected.

## 2026-05-29 — Per-line and per-route feeds (additive)

The Atom + JSON feed is now also published scoped to a single line or route,
alongside the existing global `/feed.xml` and `/feed.json`:

- Train line — `/feed/line/:line.xml` and `/feed/line/:line.json` (full line
  names: `red`, `blue`, `brown`, `green`, `orange`, `pink`, `purple`,
  `yellow`).
- Bus route — `/feed/route/:route.xml` and `/feed/route/:route.json`.

A feed exists for every train line and **every** bus route in the CTA roster up
front — not only ones with a prior incident — so a route can be subscribed
before its first incident (the feed is valid but carries no `<entry>` until
then). The global feed's URL, `<id>`, and entry format are unchanged; existing
subscribers are unaffected.

## 2026-05-27 — `direction_label` (additive)

Each bot observation now carries a pre-rendered **`direction_label`** string
(e.g. `"toward Kimball"`, `"toward the Loop"`, `"toward 95th/Dan Ryan"`)
alongside the existing opaque `direction` key. `null` when the observation
carries no usable direction info (single-branch lines, buses, or unrecognized
direction keys).

This lets renderers distinguish opposite-direction bot detections on the same
line (e.g. two simultaneous Pink Line pulse-cold posts, one inbound and one
outbound through West Loop) without having to know per-line terminus geometry.
Consumers that don't need it can ignore the field — the underlying `direction`
key is unchanged.

- **`alerts.json`** — new field at `incidents[].observations[].direction_label`.
- **`alerts.csv`** — new column `direction_label` inserted immediately after
  the existing `direction` column. Populated on `observation` rows only; blank
  on `alert` rows (CTA-side alerts don't carry a parallel label). Header-based
  CSV readers (pandas `read_csv`, etc.) are unaffected; positional readers
  pinned to column index will need to shift everything after `direction` by
  one slot.

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
