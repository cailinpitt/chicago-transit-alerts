# Data API Changelog

Breaking and notable changes to the published data at
<https://data.chicagotransitalerts.app/> — `alerts.json` and `alerts.csv` — and
the syndication feeds at <https://chicagotransitalerts.app/feed.xml> (and the
per-line/route feeds under `/feed/`). Newest first. If you build on this data,
watch this file before pinning to the format.

## 2026-06-24 — Accessibility outage archive (additive)

New endpoint: `accessibility.json`, a separate CTA rail + Metra station archive
for elevator, escalator, entrance, ADA, and accessibility notices. This keeps
minor station-accessibility notices out of the general disruption incident feed
while still publishing active outage status and recent history.

- **Payload** — `schema_version: 1`, `generated_at`, `data_start_ts`,
  `window_days`, and `outages[]`.
- **Outage rows** — each row includes `id`, `agency`, `station { slug, name,
  lines }`, `unit_type`, `unit_label`, `headline`, `description`, `lifecycle {
  first_seen_ts, last_seen_ts, restored_ts, active }`, and `source_url`.
- **Compatibility** — additive. `alerts.json`, `alerts.csv`, and feeds are
  unchanged.

## 2026-06-12 — `schema_version: 2` incident model (breaking)

`alerts.json`, `alerts.csv`, and the Atom/JSON feeds now use an agency-neutral
v2 incident shape. This is a breaking release: no v1 compatibility endpoint is
published.

- **Top-level payload** — `alerts.json` now includes `schema_version: 2`.
- **Incident identity/scope** — `incidents[].kind` is replaced by
  `incidents[].agency` (`"cta"` / `"metra"`) plus `incidents[].mode`
  (`"train"` / `"bus"` / `"commuter_rail"`). `routes` remains unchanged.
- **Sources** — `incidents[].sources` now names the contributing observer:
  official CTA alerts use `"cta"`, official Metra alerts use `"metra"`, and bot
  detections use `"bot"`.
- **Lifecycle grouping** — incident `first_seen_ts`, `resolved_ts`, `active`, and
  `duration_ms` now live under `incidents[].lifecycle`.
- **Official alerts** — `incidents[].cta` is renamed to
  `incidents[].official_alert`. Its lifecycle fields move to
  `official_alert.lifecycle`; `short_description` is renamed `description`;
  `alert_id` is renamed `id`.
- **Scope grouping** — official alert `affected_from_station`,
  `affected_to_station`, `affected_direction`, `affected_stations`, and
  `mentioned_stations` now live under `official_alert.scope` as `from_station`,
  `to_station`, `direction`, `stations`, and `mentioned_stations`.
- **Agency event window** — `cta_event_start_ts`, `cta_event_end_ts`, and their
  date-only flags now live under `official_alert.agency_event_window` as
  `start_ts`, `end_ts`, `start_is_date_only`, and `end_is_date_only`.
- **Bot detections** — `incidents[].observations[]` is renamed to
  `incidents[].detections[]`. `detection_source` is renamed `source`; station,
  route, and direction fields move to `detections[].scope`; `ts`, `onset_ts`,
  `resolved_ts`, `active`, and `duration_ms` move to `detections[].lifecycle`.
  `bot_description` is renamed `description`; evidence details are grouped under
  `detections[].evidence`.
- **Metra status** — `incidents[].metra_status` and `incidents[].cancellation`
  are collapsed into `incidents[].status`, with `type` replacing `source`.
  Schedule anchors (`train_number`, `scheduled_departure_ts`,
  `scheduled_arrival_ts`, `origin`, `delay_min`, `deadline_ts`) live in that same
  `status` object when known.
- **CSV** — `alerts.csv` now uses v2 columns:
  `record_type, incident_id, agency, mode, routes, source, status_type, headline,
  description, from_station, to_station, stations, direction, direction_label,
  first_seen_ts, onset_ts, resolved_ts, duration_minutes, active, post_url,
  resolved_post_url`.
- **Feeds** — feed entries are generated from v2 incidents and use the
  `official-alert` category term instead of `cta-alert`.

## 2026-06-12 — Metra planned delay advisories use `planned-delay` status (additive)

Official Metra construction/work-zone alerts that warn of possible delays now
publish `incidents[].metra_status.source: "planned-delay"` instead of generic
`"delay"`. This keeps multi-day planned work advisories distinct from
single-train delay alerts and bot-detected late trains.

- **Compatibility** — `metra_status` remains additive. Existing fields are
  unchanged, and clients that do not special-case `"planned-delay"` can continue
  to render the official alert headline and active/resolved lifecycle.

## 2026-06-11 — Official Metra alert status: `metra_status` (additive)

Official Metra alerts that can be classified as single-train delays or
cancellations now carry a top-level **`metra_status`** object on the incident.
This mirrors the existing Metra bot observation vocabulary (`delay`,
`cancellation`, `cancellation-inferred`) so clients can render consistent badges
for official-only Metra alerts as well as bot-detected point events.

- **New field** `incidents[].metra_status`, an object (or `null`) with:
  - `source` — currently `"delay"`, `"planned-delay"`, or `"cancellation"` for
    official Metra alerts.
  - `train_number` — the train/run number when known.
  - `delay_min` / `deadline_ts` — present for schedule-anchored delays, when known.
  - `state` — present for schedule-anchored cancellations, matching
    `incidents[].cancellation.state`.
- **Compatibility** — this is additive. Existing `cta.headline`,
  `observations[].detection_source`, and `incidents[].cancellation` are unchanged.

## 2026-06-11 — Metra single-train cancellations: `cta.cancellation` (additive)

A Metra alert that annuls exactly one scheduled train (e.g. "UPW train #67 will
not operate") now carries a top-level **`cancellation`** object on the incident,
anchoring the event to that train's timetable instead of to when Metra clears the
alert from its feed. **Additive** — `null`/absent on every other incident, and the
incident's existing `first_seen_ts` / `resolved_ts` / `active` fields are unchanged.

- **New field** `incidents[].cancellation`, an object (or `null`) with:
  - `state` — `"upcoming"` (announced, before the train's scheduled departure) or
    `"cancelled"` (the scheduled departure has passed; terminal).
  - `scheduled_departure_ts` / `scheduled_arrival_ts` — the cancelled train's
    origin departure and final arrival (epoch ms), from the GTFS timetable.
  - `train_number` — the run number as a string (e.g. `"67"`).
  - `origin` — the origin station name (e.g. `"Chicago OTC"`).
- **Lifecycle via existing fields** — an `"upcoming"` cancellation is `active:
  true` with `resolved_ts: null`; once finalized it is `active: false` with
  `resolved_ts` set to the scheduled departure (the moment the train's slot
  passed). Note this means `resolved_ts` here marks "the cancellation took effect,"
  not "service was restored" — a cancelled train does not un-cancel, so
  `resolved_ts − first_seen_ts` is **not** a meaningful disruption duration for
  these. Use `state` for the label.
- **Scope** — only single-train annulments populate this. Open-ended Metra notices
  ("no UP-N service due to police activity") carry no `cancellation` object and keep
  the ordinary ongoing→resolved lifecycle (where `resolved_ts` does mean cleared).

This is backfilled across historical Metra cancellation alerts on the next export,
not just new ones. `alerts.csv` is unaffected.

## 2026-06-10 — Metra observations drop the unused `evidence` payload + `alerts.json` minified

Two payload-size changes, both transparent to JSON consumers:

- **Metra observations no longer carry `evidence`.** Metra cancellation/delay
  observations (`detection_source` `"cancellation"` / `"cancellation-inferred"` /
  `"delay"`) previously shipped an `observations[].evidence` object
  (`tripId`, `serviceDate`, `scheduledDepTs`, `headsign`, …). That payload was
  never rendered — the rider-facing bits are already baked into the
  observation's `bot_description` and `onset_ts` — so it's now omitted to keep
  the file small on heavy-cancellation (weather) days. **CTA train/bus
  observations still carry `evidence` unchanged.** This is backfilled across all
  historical Metra incidents on the next export, not just new ones.
- **`alerts.json` is now minified** (no pretty-print indentation). Pure
  formatting — `JSON.parse` consumers are unaffected; only anyone diffing the
  raw bytes will notice. Shaves ~30% off the uncompressed payload (and the
  parse time every client pays on load).

## 2026-06-10 — Metra in the CSV + syndication feeds (additive)

Metra incidents (`kind: "metra"`, shipped 2026-06-09) now also flow through the
flat CSV and the Atom/JSON feeds — they are no longer `alerts.json`-only.

- **CSV** (`alerts.csv`) — Metra rows are emitted with `kind` `"metra"`,
  lowercase Metra line keys in `routes`, and the `"cancellation"` /
  `"cancellation-inferred"` / `"delay"` `detection_source` values. The column
  layout is unchanged.
- **Global feed** (`feed.xml` / `feed.json`) — Metra incidents now appear in the
  combined feed, tagged with a `metra` category and a `metra-line-<key>` category
  per line.
- **New per-line Metra feeds** — `/feed/metra/line/:line.xml` (+ `.json` twin) for
  every Metra line, mirroring the CTA `/feed/line/` and `/feed/route/` feeds. The
  Metra path prefix keeps them in a separate namespace from the CTA line feeds.
- **Postless entries** — Metra cancellation/delay feed entries carry no
  `external_url`/`post_url` (website-data-first) and link to the on-site event
  page (`/event/<incident-id>`) rather than a Bluesky post.

## 2026-06-09 — Metra commuter rail incidents: `kind: "metra"` (additive)

`alerts.json` now includes Metra (Chicago commuter rail) incidents alongside the
existing CTA train + bus incidents. This is **additive** — consumers that filter
to `kind` `"train"` / `"bus"` are unaffected.

- **New `kind` value** — `incidents[].kind` can now be `"metra"` (in addition to
  `"train"` and `"bus"`).
- **Routes** — `incidents[].routes` for a Metra incident are lowercase Metra line
  keys: `bnsf`, `hc`, `md-n`, `md-w`, `me`, `ncs`, `ri`, `sws`, `up-n`, `up-nw`,
  `up-w` (the GTFS route_ids lowercased).
- **New `detection_source` values** on Metra bot observations:
  `"cancellation"` (Metra-flagged cancelled train), `"cancellation-inferred"` (a
  scheduled train the bot never saw run, not flagged by Metra — hedged), and
  `"delay"` (a train that ran 15+ min late). Cancellations are the Metra analog of
  a CTA "ghost"; delays are the analog of a "gap".
- **Lifecycle** — Metra cancellation/delay observations are point-in-time events
  (`active: false`, `resolved_ts == ts`); `onset_ts` is back-dated to the train's
  scheduled departure. They carry no individual `post_url` (the bot summarizes
  them in an hourly per-line rollup rather than posting each one).

The CSV (`alerts.csv`) and syndication feeds (`feed.xml`, `/feed/`) remain
**CTA-only** for now; Metra appears in `alerts.json` only.

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
  `sources` field listing which contributed (`"cta"`, `"bot"`, or both in this
  v1-era model; v2 also uses `"metra"` for official Metra alerts). The
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
