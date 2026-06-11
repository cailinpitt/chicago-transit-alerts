// Merging and filtering logic for the alerts + observations feed.
// "Merging" pairs an official CTA alert with a matching bot observation on the
// same line within a 2-hour window so the two sources don't double-count.

import { BUS_ROUTE_NAMES } from './busRoutes.js';
import { TRAIN_LINES } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';
import { metraLineInfo } from './metraLines.js';

// Flatten the published `incidents[]` wire shape into the `{ alerts, observations }`
// representation the analytics layer (aggregate.js, CSV/feed generators, the
// station index) still consumes.
//
// The fuzzy alert↔observation pairing now happens server-side (cta-insights
// `export-web.js`); each incident already groups its CTA alert with the bot
// observations that belong to it. We flatten that back out — one flat alert
// per `incident.cta`, plus every `incident.observations` row — and stamp each
// record with `_incidentId` so `mergeMatchingIncidents` can regroup by that
// decision without re-matching. Train line keys arrive already normalized to
// full names ('green'), so no per-record normalization happens here anymore.
//
// View components no longer go through this — they read the nested `incidents[]`
// directly (see EventPage, findIncidentById). It survives only for the analytics
// helpers that haven't been moved onto the nested shape.
/**
 * @param {Incident[]} incidents
 * @returns {{ alerts: Alert[], observations: Observation[] }}
 */
export function flattenIncidents(incidents) {
  const alerts = [];
  const observations = [];
  for (const inc of incidents || []) {
    if (inc.cta) alerts.push(flattenIncidentAlert(inc));
    for (const o of inc.observations || []) {
      observations.push({ ...o, _incidentId: inc.id });
    }
  }
  return { alerts, observations };
}

// Reconstruct the flat Alert shape from an incident's nested `cta` block. The
// incident carries `kind`/`routes` at the top level and CTA's own lifecycle
// (first_seen_ts/resolved_ts/active) inside `cta`.
function flattenIncidentAlert(inc) {
  const c = inc.cta;
  const alert = {
    alert_id: c.alert_id,
    kind: inc.kind,
    routes: inc.routes,
    headline: c.headline,
    short_description: c.short_description ?? null,
    first_seen_ts: c.first_seen_ts,
    resolved_ts: c.resolved_ts ?? null,
    duration_ms: c.resolved_ts != null ? c.resolved_ts - c.first_seen_ts : null,
    active: c.active,
    post_url: c.post_url,
    resolved_reply_url: c.resolved_reply_url ?? null,
    affected_from_station: c.affected_from_station ?? null,
    affected_to_station: c.affected_to_station ?? null,
    affected_direction: c.affected_direction ?? null,
    mentioned_stations: c.mentioned_stations ?? [],
    // Full station fill of the affected segment (endpoints + inner stops),
    // enumerated upstream. Lets buildStationIndex tie the inner stations to
    // the incident, not just the two named endpoints.
    affected_stations: c.affected_stations ?? [],
    cta_event_start_ts: c.cta_event_start_ts ?? null,
    cta_event_end_ts: c.cta_event_end_ts ?? null,
    cta_event_start_is_date_only: c.cta_event_start_is_date_only ?? false,
    cta_event_end_is_date_only: c.cta_event_end_is_date_only ?? false,
    // Schedule-anchored single-train Metra cancellation (null otherwise).
    // Top-level on the incident, not under the `cta` block.
    cancellation: inc.cancellation ?? null,
    _incidentId: inc.id,
  };
  // versions only present when CTA edited the alert (>1 version on the wire).
  if (c.versions && c.versions.length > 1) alert.versions = c.versions;
  return alert;
}

/**
 * Top-level payload served by `public/data/alerts.json`. Regenerated server-
 * side every ~7 minutes by the cta-insights pipeline. The wire format is a list
 * of unified `incidents`; the view reads them directly, while the analytics
 * layer flattens them to `{ alerts, observations }` via `flattenIncidents`.
 *
 * @typedef {object} AlertsPayload
 * @property {number} generated_at  Epoch ms when the snapshot was produced.
 * @property {number} data_start_ts Earliest moment we have coverage for; days
 *   before this are rendered as "no data" rather than "no incidents".
 * @property {Incident[]} incidents
 */

/**
 * One real-world disruption as published on the wire. Pairs the official CTA
 * alert (`cta`, null for bot-only incidents) with the bot observation(s)
 * describing the same event (`observations`, empty for CTA-only incidents).
 * The alert↔observation pairing is done server-side; the frontend never merges.
 *
 * @typedef {object} Incident
 * @property {string} id            Stable permalink id (Bluesky post rkey).
 * @property {'train' | 'bus'} kind
 * @property {string[]} routes      Full train line names ('red', 'green', …) or bus route numbers.
 * @property {number} first_seen_ts
 * @property {number | null} resolved_ts
 * @property {boolean} active
 * @property {Array<'cta' | 'bot'>} sources  Which observers contributed.
 * @property {IncidentCta | null} cta        The official CTA alert, or null.
 * @property {Observation[]} observations    Bot detections, or [].
 */

/**
 * The `cta` sub-block of an {@link Incident}. Carries CTA's own lifecycle
 * (first_seen_ts/resolved_ts/active) distinct from the incident-level fields,
 * so the service-stabilization delta (CTA cleared vs. bot saw recovery) stays
 * computable. `flattenIncidents` expands this back into a flat {@link Alert}.
 *
 * @typedef {object} IncidentCta
 * @property {string} alert_id
 * @property {string} headline
 * @property {string | null} [short_description]
 * @property {string} [post_url]
 * @property {string | null} [resolved_reply_url]
 * @property {number} first_seen_ts
 * @property {number | null} resolved_ts
 * @property {boolean} active
 * @property {string | null} [affected_from_station]
 * @property {string | null} [affected_to_station]
 * @property {string | null} [affected_direction]
 * @property {string[]} [mentioned_stations]
 * @property {string[]} [affected_stations]  Full station fill of the affected segment (endpoints + inner stops), enumerated upstream per route. Empty when no segment resolves; falls back to affected_from/to_station.
 * @property {number | null} [cta_event_start_ts]
 * @property {number | null} [cta_event_end_ts]
 * @property {boolean} [cta_event_start_is_date_only]
 * @property {boolean} [cta_event_end_is_date_only]
 * @property {object[]} [versions]  Present only when CTA edited the alert text.
 */

/**
 * Official CTA service alert (one per `alert_id`). `routes` is plural because
 * the CTA sometimes scopes a single alert to multiple lines (e.g. Red+Purple
 * shared trackage).
 *
 * @typedef {object} Alert
 * @property {string} alert_id
 * @property {'train' | 'bus'} kind
 * @property {string[]} routes              Train line keys ('red', 'g', …) or bus route numbers.
 * @property {string} headline
 * @property {string | null} [short_description]  CTA's own body text for the alert (ShortDescription,
 *   falling back to FullDescription) — the reroute/closure details published with the headline.
 * @property {number} first_seen_ts
 * @property {number} [last_seen_ts]
 * @property {number | null} resolved_ts    null = still open.
 * @property {number | null} duration_ms
 * @property {boolean} active
 * @property {string} [post_url]            Bluesky post announcing the alert.
 * @property {string} [resolved_reply_url]  Reply post when the alert cleared.
 * @property {string | null} [affected_from_station]
 * @property {string | null} [affected_to_station]
 * @property {string | null} [affected_direction]
 * @property {string[]} [mentioned_stations]  Canonical station names extracted from the alert text (line-scoped). Empty/missing when nothing resolved.
 * @property {string[]} [affected_stations]  Full station fill of the affected segment (endpoints + inner stops), enumerated from the line geometry. Empty when no segment resolves.
 * @property {number | null} [cta_event_start_ts]  CTA's own claimed event start (from EventStart).
 * @property {number | null} [cta_event_end_ts]    CTA's own claimed event end (from EventEnd).
 * @property {boolean} [cta_event_start_is_date_only]  CTA posted EventStart as a date with no time.
 * @property {boolean} [cta_event_end_is_date_only]    CTA posted EventEnd as a date with no time.
 */

/**
 * Bot-detected observation — gap, bunching, ghost, pulse, or roundup. Singular
 * `line` (vs. `routes` on Alert) because each observation is scoped to one
 * line/route.
 *
 * @typedef {object} Observation
 * @property {number} id
 * @property {'train' | 'bus'} kind
 * @property {string} line                  'red'/'g'/etc. for trains, route number string for buses.
 * @property {string | null} [direction]     Opaque per-line direction key (e.g. 'branch-0-outbound', 'branch-len116-41722--87624', 'all'). Use `direction_label` for display.
 * @property {string | null} [direction_label] Pre-rendered 'toward <terminus>' string for the renderer (e.g. 'toward Kimball', 'toward the Loop', 'toward 95th/Dan Ryan'). Null when `direction` carries no usable terminus info (single-branch lines, buses, unrecognized keys).
 * @property {string | null} [from_station]
 * @property {string | null} [to_station]
 * @property {string[]} [stations]          Full station fill of the observed stretch (endpoints + inner stops), ordered from_station → to_station. Omitted when the segment can't be enumerated (e.g. roundups); fall back to from_station/to_station.
 * @property {'roundup' | string} [detection_source]  'roundup' = multi-signal correlation.
 * @property {string[]} [signals]           Signal sources for roundups: 'gap', 'bunching', 'ghost', 'pulse-cold', 'pulse-held'.
 * @property {number} ts                    When the bot first posted; matches post_url. Used as the start when onset_ts is absent.
 * @property {number | null} [onset_ts]     Disruption start for absence-style observations (pulse-cold, thin-gap, roundups bundling them), back-dated from `ts` to the last observed train. Null when not back-dated.
 * @property {number | null} resolved_ts
 * @property {number | null} [duration_ms]  resolved_ts - (onset_ts ?? ts); null while active.
 * @property {boolean} active
 * @property {string} [post_url]
 * @property {string | null} [resolved_post_url]
 * @property {string} [onset_description]   Pre-rendered sentence for the onset timeline entry (the back-dated start at `onset_ts`). Omitted when there's no meaningful back-date.
 */

/**
 * Result of merging an Alert with a matching Observation. Carries fields from
 * both plus the metadata the UI uses to flag it as a merged record.
 *
 * @typedef {object} MergedIncident
 * @property {'merged'} _type
 * @property {number} _sortTs
 * @property {string} alert_id
 * @property {'train' | 'bus'} kind
 * @property {string[]} routes
 * @property {string} headline
 * @property {string | null} [short_description]
 * @property {number} first_seen_ts
 * @property {number | null} resolved_ts
 * @property {boolean} active
 * @property {string} [post_url]
 * @property {string} [resolved_reply_url]
 * @property {string | null} [affected_from_station]
 * @property {string | null} [affected_to_station]
 * @property {string | null} [affected_direction]
 * @property {string[]} [mentioned_stations]
 * @property {string | null} [from_station]
 * @property {string | null} [to_station]
 * @property {string} [obs_post_url]
 * @property {string | null} [obs_resolved_post_url]
 * @property {number} obs_id
 * @property {Array<{id: number, post_url?: string, resolved_post_url?: string | null, ts: number, resolved_ts?: number | null, detection_source?: string, signals?: string[], from_station?: string | null, to_station?: string | null, line?: string}>} [extra_obs]
 */

// User-visible signal categories — the chips and stacked-bar segments.
// Order is the display order. Aligns with the cta-bot pipeline's pulse
// subtypes: an observation's detection_source is one of these (or 'roundup',
// in which case the precise signal kinds live in `signals`).
export const SIGNAL_TYPES = ['gap', 'bunching', 'ghost', 'pulse-cold', 'pulse-held', 'thin-gap'];

// Source categories for the filter chip. Each incident falls into exactly
// one bucket after `mergeMatchingIncidents` runs:
//   'cta'    — CTA alert with no matching bot detection
//   'bot'    — bot detection with no matching CTA alert
//   'merged' — CTA alert and bot detection that paired up
// Order is the display order in the popover; keep it CTA → bot → merged so
// the "they agreed" row sits at the end as the strongest signal.
export const SOURCE_TYPES = ['cta', 'bot', 'merged'];
export const SOURCE_LABELS = {
  cta: 'CTA reported',
  bot: 'Bot observation',
  merged: 'Both',
};

// Friendly labels for every signal kind.
export const SIGNAL_LABELS = {
  gap: 'headway gaps',
  bunching: 'bunching',
  ghost: 'missing vehicles',
  'pulse-cold': 'stretch without trains',
  'pulse-held': 'trains held in place',
  // thin-gap fires when a low-frequency bus route has zero observations for a
  // full headway-derived window — the route effectively stopped running. It
  // covers the 47 routes outside the curated gap/ghost lists, which have no
  // other detector coverage.
  'thin-gap': 'low-frequency route silent',
  // Metra (commuter rail) detection_source values. Cancellation is the Metra
  // analog of a ghost; delay is the analog of a gap. 'cancellation-inferred' is a
  // scheduled train the bot never saw run, that Metra didn't flag (hedged).
  cancellation: 'cancelled trains',
  'cancellation-inferred': 'trains not seen running',
  delay: 'late trains',
};

// Rider-facing impact phrase for each signal kind — the plain-language outcome a
// rider feels, not the detector's name. `vehicles` is 'trains' or 'buses' so the
// phrase reads right for either mode. Used to build scannable incident titles
// (see summarizeSignals); SIGNAL_LABELS stays the detector-noun form for chips.
const SIGNAL_IMPACT = {
  gap: () => 'long gaps',
  bunching: (v) => `bunched ${v}`,
  ghost: (v) => `fewer ${v}`,
  'pulse-cold': (v) => `stretch without ${v}`,
  'pulse-held': (v) => `${v} held in place`,
  'thin-gap': () => 'route not running',
  cancellation: () => 'cancelled trains',
  'cancellation-inferred': (v) => `${v} not seen running`,
  delay: () => 'late trains',
};

// Turn a detection's signal mix into a single plain-language title, e.g.
// "Fewer trains and long gaps". Joined as a natural list ("X and Y", "X, Y, and
// Z") rather than a jargon list ("Multiple signals: missing vehicles, headway
// gaps, …") — and rather than truncating to "+N more", which hid what was
// happening. A roundup carries at most ~3 distinct signals in practice, so the
// full list stays short. Returns null when there are no signals. `kind` is
// 'bus' | 'train' (defaults to train).
/**
 * @param {string[]} signals
 * @param {string} [kind]
 * @returns {string | null}
 */
export function summarizeSignals(signals, kind) {
  const uniq = [...new Set(signals || [])];
  if (uniq.length === 0) return null;
  const v = kind === 'bus' ? 'buses' : 'trains';
  const phrases = uniq.map((s) =>
    SIGNAL_IMPACT[s] ? SIGNAL_IMPACT[s](v) : (SIGNAL_LABELS[s] ?? s),
  );
  let text;
  if (phrases.length === 1) text = phrases[0];
  else if (phrases.length === 2) text = `${phrases[0]} and ${phrases[1]}`;
  else text = `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Compact human-readable summary of the bot's evidence for this observation
// — surfaced as a small chip on incident rows so a reader can see *why* the
// bot fired without reading the full Bluesky post. Returns null when there's
// nothing material to render (alerts, missing evidence payload, roundups —
// the signal mix is already shown via the description text).
/**
 * @param {object} incident An Alert, Observation, or MergedIncident.
 * @returns {string | null}
 */
export function formatEvidenceChip(incident) {
  if (!incident) return null;
  const ev = incident.evidence;
  if (!ev || typeof ev !== 'object') return null;
  // Train pulse evidence has the canonical fields. The held subtree exists
  // when the candidate was a held-cluster (or inferred-held from cold).
  if (ev.held && typeof ev.held === 'object' && ev.held.trainCount != null) {
    const min = ev.held.stationaryMs ? Math.round(ev.held.stationaryMs / 60000) : null;
    const noun = incident.kind === 'bus' ? 'buses' : 'trains';
    const single = noun === 'buses' ? 'bus' : 'train';
    const countLabel = `${ev.held.trainCount} ${ev.held.trainCount === 1 ? single : noun} held`;
    return min != null ? `${countLabel} · ${min} min stationary` : countLabel;
  }
  // Bus held shape (no nested .held — fields live at the top level).
  if (ev.kind === 'held' && ev.busCount != null) {
    const min = ev.stationaryMs ? Math.round(ev.stationaryMs / 60000) : null;
    const countLabel = `${ev.busCount} ${ev.busCount === 1 ? 'bus' : 'buses'} held`;
    return min != null ? `${countLabel} · ${min} min stationary` : countLabel;
  }
  // Train cold evidence.
  if (ev.coldStations != null || ev.expectedTrains != null) {
    const parts = [];
    if (ev.coldStations) {
      parts.push(
        `${ev.coldStations} ${ev.coldStations === 1 ? 'station' : 'stations'} without trains`,
      );
    }
    if (ev.expectedTrains) {
      parts.push(`${ev.expectedTrains} ${ev.expectedTrains === 1 ? 'train' : 'trains'} missed`);
    } else if (ev.minutesSinceLastTrain) {
      parts.push(`${ev.minutesSinceLastTrain} min since last train`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  // Thin-gap evidence: low-frequency route with zero observations across the
  // headway-derived window.
  if (ev.windowMin != null && ev.headwayMin != null && ev.missedTrips != null) {
    const win = Math.round(ev.windowMin);
    const hw = Math.round(ev.headwayMin);
    return `no buses in ${win} min · scheduled every ~${hw} min`;
  }
  // Bus blackout shape.
  if (ev.kind === 'cold' && ev.lookbackMin != null) {
    const parts = [`no buses in ${ev.lookbackMin} min`];
    if (ev.expectedActive && ev.expectedActive >= 1) {
      parts.push(`${Math.round(ev.expectedActive)} expected`);
    }
    return parts.join(' · ');
  }
  return null;
}

// Returns the set of signal kinds this observation represents. Roundup
// observations carry an explicit `signals` array; single-signal observations
// expose their kind via `detection_source`. Alerts have no signals.
/**
 * @param {Observation} obs
 * @returns {string[]}
 */
export function observationSignals(obs) {
  if (!obs) return [];
  if (obs.detection_source === 'roundup') return obs.signals || [];
  return obs.detection_source ? [obs.detection_source] : [];
}

// Plain-text title for a bot incident that has no single affected stretch (the
// station-pair case is handled by the callers, which may render it as links).
// Summarizes the signal mix as rider-facing impact ("Fewer trains and long
// gaps"); falls back to a generic line only when there are no signals at all.
/**
 * @param {Incident} incident
 * @returns {string}
 */
export function botSummaryText(incident) {
  const { primary } = splitObservations(incident);
  const summary = summarizeSignals(observationSignals(primary), incident?.kind);
  if (summary) return summary;
  if (primary?.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  return 'Service disruption detected';
}

// Metra bot-detected point events — one scheduled train that ran late, was
// cancelled, or was never seen running. These are recorded website-data-first
// (no per-trip Bluesky post; an hourly rollup digest summarizes them), so they
// arrive as bot-only incidents with the rider-facing sentence pre-rendered in
// `bot_description` (e.g. "~57 min late — the 12:05 PM … train", "Scheduled
// train not seen running — the 9:55 AM Joliet train"). Without intervention the
// row shows only the station pair, which reads like a route; so we lead with the
// sentence and stamp a short status badge per kind.
const METRA_POINT_SOURCES = new Set(['delay', 'cancellation', 'cancellation-inferred']);

/**
 * True when `source` is one of the Metra point-event detection kinds.
 * @param {string | null | undefined} source
 */
export function isMetraPointSource(source) {
  return source != null && METRA_POINT_SOURCES.has(source);
}

/**
 * Normalize a Metra point-event incident for display, or null when the incident
 * isn't one. Skips merged incidents that carry a Metra alert (`cta`) — those
 * render from the alert headline. `lede` is the pre-rendered sentence to lead
 * the row/title with; null when the bot shipped none (callers fall back to the
 * station pair, with the badge still marking the kind).
 * @param {Incident} incident
 * @returns {{ source: string, lede: string | null, fromStation: string | null, toStation: string | null, directionLabel: string | null } | null}
 */
export function metraPointEvent(incident) {
  if (!incident || incident.cta) return null;
  const { primary } = splitObservations(incident);
  if (!primary || !isMetraPointSource(primary.detection_source)) return null;
  return {
    source: primary.detection_source,
    lede: primary.bot_description ?? null,
    fromStation: primary.from_station ?? null,
    toStation: primary.to_station ?? null,
    directionLabel: primary.direction_label ?? null,
  };
}

// Short status-badge label for each Metra point-event kind. 'cancellation-
// inferred' reads "possible cancellation" — the train was scheduled but never
// seen and Metra didn't flag it, so the outcome is stated while signalling it's
// unconfirmed. Returns null for unknown kinds.
/**
 * @param {string} source
 * @returns {string | null}
 */
export function metraPointEventLabel(source) {
  switch (source) {
    case 'delay':
      return 'delayed';
    case 'cancellation':
      return 'cancelled';
    case 'cancellation-inferred':
      return 'possible cancellation';
    default:
      return null;
  }
}

// The per-line affected stretches for an incident, as `{ line, from, to }`
// segments. A multi-line incident (a Loop-wide alert that merged several
// pulse-cold detections) carries one segment per merged observation, each on
// its OWN line — the multi-line event map uses these to highlight each line's
// real stretch instead of drawing one arbitrary line. `line` is null for an
// alert-level segment ("between Belmont and Howard" with no single owning
// line); the renderer then highlights it on every drawn line serving both
// endpoints.
/**
 * @param {Incident} incident
 * @returns {Array<{ line: string | null, from: string | null, to: string | null }>}
 */
export function affectedLineSegments(incident) {
  if (!incident) return [];
  const out = [];
  const push = (line, from, to) => {
    if (!from && !to) return;
    out.push({ line: line ?? null, from: from ?? null, to: to ?? null });
  };
  const cta = incident.cta;
  const { primary, extras } = splitObservations(incident);
  if (cta && primary) {
    // Merged: the primary observation's stretch, then the extras that rode
    // along, then the alert's own (line-agnostic) segment endpoints.
    push(primary.line ?? null, primary.from_station, primary.to_station);
    for (const e of extras) push(e.line ?? null, e.from_station, e.to_station);
    push(null, cta.affected_from_station, cta.affected_to_station);
  } else if (cta) {
    // Pure CTA alert: only the alert-level segment, applied across its routes.
    push(null, cta.affected_from_station, cta.affected_to_station);
  } else if (primary) {
    // Bot-only: the observation's own stretch.
    push(primary.line ?? null, primary.from_station, primary.to_station);
  }
  return out;
}

// Extract the rkey at the end of a Bluesky post URL — the part after `/post/`.
// Used as the canonical event id for shareable links. Returns null for missing
// or malformed URLs so callers can decide whether to render the share control.
/**
 * @param {string | null | undefined} postUrl
 * @returns {string | null}
 */
export function postUrlRkey(postUrl) {
  if (!postUrl) return null;
  const m = /\/post\/([^/?#]+)/.exec(postUrl);
  return m ? m[1] : null;
}

// Format a multi-route/multi-line label for display. Single-route bus alerts
// keep their verbose `#3 King Drive` name; multi-route alerts collapse to
// the bare numbers (e.g. `#136, #147, #151`) so the label stays short
// enough for headings and OG cards. 4+ routes wrap as `first two + N more`
// or `N train lines`.
/**
 * @param {'train'|'bus'|'metra'} kind
 * @param {string[]} routes
 * @returns {string}
 */
// The official-source agency for an incident's `cta`/alert block. For Metra the
// "cta" block actually holds Metra's own GTFS-rt alert (republished), so it reads
// as "Metra", not "CTA". Used wherever the UI labels the official source.
/**
 * @param {'train'|'bus'|'metra'} kind
 * @returns {string}
 */
export function agencyLabel(kind) {
  return kind === 'metra' ? 'Metra' : 'CTA';
}

export function formatRoutesLabel(kind, routes) {
  if (!routes || routes.length === 0) return kind === 'bus' ? 'this route' : 'this line';
  if (kind === 'train') {
    const labels = routes.map((r) => TRAIN_LINES[r]?.label ?? r);
    if (labels.length === 1) return `${labels[0]} Line`;
    if (labels.length === 2) return `${labels[0]} and ${labels[1]} Lines`;
    if (labels.length === 3) return `${labels[0]}, ${labels[1]}, and ${labels[2]} Lines`;
    return `${labels.length} train lines`;
  }
  if (kind === 'metra') {
    // Metra lines carry their own name ("BNSF", "Metra Electric") — no " Line".
    const labels = routes.map((r) => metraLineInfo(r)?.label ?? r);
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    if (labels.length === 3) return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
    return `${labels.length} Metra lines`;
  }
  // bus
  if (routes.length === 1) {
    const name = BUS_ROUTE_NAMES[routes[0]] ?? BUS_ROUTE_NAMES[String(routes[0])];
    return name ? `#${routes[0]} ${name}` : `#${routes[0]}`;
  }
  const nums = routes.map((r) => `#${r}`);
  if (nums.length === 2) return `${nums[0]} and ${nums[1]}`;
  if (nums.length === 3) return nums.join(', ');
  return `${nums.slice(0, 2).join(', ')} + ${nums.length - 2} more`;
}

// Find an incident by its shareable event id. The id is the top-level
// `incident.id` (the alert post rkey when CTA is present, else the bot post
// rkey), but a link copied from any of an incident's bot posts should still
// resolve, so we also match the CTA post rkey and every observation's post
// rkey. Returns the nested incident the view renders directly.
/**
 * @param {Incident[]} incidents
 * @param {string} id
 * @returns {Incident | null}
 */
export function findIncidentById(incidents, id) {
  if (!id) return null;
  for (const inc of incidents || []) {
    if (inc.id === id) return inc;
    if (postUrlRkey(inc.cta?.post_url) === id) return inc;
    if ((inc.observations || []).some((o) => postUrlRkey(o.post_url) === id)) return inc;
  }
  return null;
}

// Find incidents on the same line(s) within ±windowMs of the given incident,
// excluding the incident itself. Used by the event detail page to show
// surrounding context — was this disruption isolated, or part of a cluster of
// problems on the same line?
/**
 * @param {Incident} incident
 * @param {Incident[]} incidents
 * @param {number} [windowMs] Time window before/after; defaults to 24h.
 * @returns {Incident[]} Sorted newest-first, excluding self.
 */
export function findRelatedIncidents(incident, incidents, windowMs = 24 * 60 * 60 * 1000) {
  if (!incident) return [];
  const routes = new Set(incident.routes || []);
  if (routes.size === 0) return [];
  const kind = incident.kind;
  const ts = incident.first_seen_ts;
  if (ts == null) return [];
  const lo = ts - windowMs;
  const hi = ts + windowMs;

  const out = [];
  for (const other of incidents || []) {
    if (other.id === incident.id) continue;
    if (other.kind !== kind) continue;
    if (!(other.routes || []).some((r) => routes.has(r))) continue;
    const t = other.first_seen_ts;
    if (t == null || t < lo || t > hi) continue;
    out.push(other);
  }

  out.sort((a, b) => b.first_seen_ts - a.first_seen_ts);
  return out;
}

// Find incidents whose start time falls within ±windowMs of the given event
// AND which affect a DIFFERENT line/route. Used by the event detail page to
// answer "was this part of a system-wide problem at the same moment?" — a
// signal-boost when a power outage, weather event, or letout simultaneously
// hits multiple lines. Returns sorted newest-first, deduped on event id.
//
// Bus and train cross-pollinate intentionally: a Red Line meltdown can spawn
// shuttle-bus reroutes on the same hour, and surfacing that pairing helps the
// reader piece the picture together. Each row carries its own `kind` so the
// caller can render an appropriate line/route pill.
/**
 * @param {Incident} incident
 * @param {Incident[]} incidents
 * @param {number} [windowMs] Time window before/after; defaults to 1h.
 * @returns {Incident[]}
 */
export function findContemporaneousOnOtherLines(incident, incidents, windowMs = 60 * 60 * 1000) {
  if (!incident) return [];
  const selfRoutes = new Set(incident.routes || []);
  const selfKind = incident.kind;
  const ts = incident.first_seen_ts;
  if (ts == null) return [];
  const lo = ts - windowMs;
  const hi = ts + windowMs;

  // Same kind + a shared route means it's the same line — RelatedIncidents
  // already covers that, so it's excluded here. Cross-kind (train vs bus) is
  // always "different" because the route key spaces are disjoint.
  const overlapsSelfRoutes = (other) =>
    other.kind === selfKind && (other.routes || []).some((r) => selfRoutes.has(r));

  const out = [];
  for (const other of incidents || []) {
    if (other.id === incident.id) continue;
    const t = other.first_seen_ts;
    if (t == null || t < lo || t > hi) continue;
    if (overlapsSelfRoutes(other)) continue;
    out.push(other);
  }

  out.sort((a, b) => b.first_seen_ts - a.first_seen_ts);
  return out;
}

// Regroup flat alerts/observations back into the merged / standalone buckets
// the analytics layer (aggregate.js) and a couple of components still consume.
// The fuzzy alert↔observation pairing is NOT done here — it happens server-side
// in cta-insights and is baked into each record's `_incidentId` by
// `flattenIncidents`. This just groups by that id, so a CTA alert and the bot
// observations that share its incident reassemble into one merged record, while
// everything else falls through as standalone. (The view layer reads the nested
// `incidents[]` directly and never calls this.)
//
// Returns:
//   merged           — combined alert+observation records (built shape below)
//   standaloneAlerts — alerts whose incident had no observation (or whose obs
//                      were filtered away upstream)
//   standaloneObs    — observations whose incident's alert was filtered away,
//                      or bot-only incidents
//
// Records lacking `_incidentId` (e.g. hand-built in tests, or any object that
// didn't pass through `flattenIncidents`) fall back to a per-record id so
// they never accidentally group together.
/**
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @returns {{ merged: MergedIncident[], standaloneAlerts: Alert[], standaloneObs: Observation[] }}
 */
export function mergeMatchingIncidents(alerts, observations) {
  const groups = new Map();
  const order = [];
  const groupFor = (id) => {
    let g = groups.get(id);
    if (!g) {
      g = { alert: null, obs: [] };
      groups.set(id, g);
      order.push(id);
    }
    return g;
  };
  // Records that never passed through flattenIncidents (e.g. hand-built in
  // tests) have no _incidentId; give each a unique key so they never group.
  for (const a of alerts || []) groupFor(a._incidentId ?? Symbol('alert')).alert = a;
  for (const o of observations || []) groupFor(o._incidentId ?? Symbol('obs')).obs.push(o);

  const merged = [];
  const standaloneAlerts = [];
  const standaloneObs = [];
  for (const id of order) {
    const { alert, obs } = groups.get(id);
    if (alert && obs.length > 0) merged.push(buildMergedRecord(alert, obs));
    else if (alert) standaloneAlerts.push(alert);
    else for (const o of obs) standaloneObs.push(o);
  }
  return { merged, standaloneAlerts, standaloneObs };
}

// Build the flat MergedIncident the list/event components render, from a CTA
// alert and its grouped observations. Shape is unchanged from when the merge
// ran client-side, so every consumer keeps working.
function buildMergedRecord(alert, obsList) {
  // Primary obs = closest in time to the alert (most likely the detection that
  // caught the same onset CTA published). The single-obs fields (obs_post_url,
  // from_station, …) reflect this primary; the rest ride along on extra_obs.
  const matches = [...obsList].sort(
    (a, b) => Math.abs(a.ts - alert.first_seen_ts) - Math.abs(b.ts - alert.first_seen_ts),
  );
  const primary = matches[0];
  const extras = matches.slice(1);
  // While the incident is active, a paired obs's prior resolution doesn't end
  // the incident — surfacing it would produce a "last seen" before "first seen"
  // and a misleading "Bot resolution" link. Suppress resolution-side fields
  // until the alert resolves.
  const active = alert.active || matches.some((o) => o.active);
  return {
    _type: 'merged',
    _sortTs: alert.first_seen_ts,
    alert_id: alert.alert_id,
    kind: alert.kind,
    routes: alert.routes,
    headline: alert.headline,
    short_description: alert.short_description ?? null,
    first_seen_ts: alert.first_seen_ts,
    resolved_ts: active ? null : (alert.resolved_ts ?? primary.resolved_ts ?? null),
    active,
    post_url: alert.post_url,
    resolved_reply_url: alert.resolved_reply_url,
    affected_from_station: alert.affected_from_station,
    affected_to_station: alert.affected_to_station,
    affected_direction: alert.affected_direction,
    mentioned_stations: alert.mentioned_stations ?? [],
    // Only present when CTA edited the alert text (>1 version on the wire).
    versions: alert.versions,
    // CTA's claimed event window, so EventPage can compare their stated end to
    // the actual resolve timestamp.
    cta_event_start_ts: alert.cta_event_start_ts ?? null,
    cta_event_end_ts: alert.cta_event_end_ts ?? null,
    cta_event_start_is_date_only: alert.cta_event_start_is_date_only === true,
    cta_event_end_is_date_only: alert.cta_event_end_is_date_only === true,
    from_station: primary.from_station,
    to_station: primary.to_station,
    obs_post_url: primary.post_url,
    obs_resolved_post_url: active ? null : primary.resolved_post_url,
    // The bot's resolved_ts requires sustained recovery before firing; comparing
    // it to the alert's resolved_ts (when both resolved) gives the
    // service-stabilization delta. Null while active to avoid the hazard above.
    obs_resolved_ts: active ? null : (primary.resolved_ts ?? null),
    obs_ts: primary.ts,
    obs_id: primary.id,
    obs_line: primary.line,
    obs_detection_source: primary.detection_source,
    obs_signals: primary.signals,
    extra_obs: extras.map((e) => ({
      id: e.id,
      post_url: e.post_url,
      resolved_post_url: active ? null : e.resolved_post_url,
      ts: e.ts,
      resolved_ts: active ? null : (e.resolved_ts ?? null),
      detection_source: e.detection_source,
      signals: e.signals,
      from_station: e.from_station,
      to_station: e.to_station,
      line: e.line,
    })),
  };
}

// Split a nested incident's observations into a primary and the rest. The
// primary is the detection closest in time to the CTA alert (so the rendered
// "from → to" / detection link matches what older merged records showed), or
// the sole/first observation for a bot-only incident.
/**
 * @param {Incident} incident
 * @returns {{ primary: Observation | null, extras: Observation[] }}
 */
export function splitObservations(incident) {
  const obs = incident?.observations || [];
  if (obs.length === 0) return { primary: null, extras: [] };
  if (incident.cta) {
    const anchor = incident.cta.first_seen_ts;
    const sorted = [...obs].sort((a, b) => Math.abs(a.ts - anchor) - Math.abs(b.ts - anchor));
    return { primary: sorted[0], extras: sorted.slice(1) };
  }
  return { primary: obs[0], extras: obs.slice(1) };
}

// Which source bucket an incident falls in: 'merged' (CTA + bot), 'cta' (CTA
// alert with no bot detection), or 'bot' (bot-only). Drives the source filter.
/**
 * @param {Incident} incident
 * @returns {'cta' | 'bot' | 'merged'}
 */
export function incidentSource(incident) {
  if (!incident.cta) return 'bot';
  return (incident.observations?.length ?? 0) > 0 ? 'merged' : 'cta';
}

// Build the per-incident text matcher used by both `filterIncidents` and
// `searchFilterIncidents`. Returned as `{ hasSearch, matchesIncident }`; when
// the query is blank `matchesIncident` returns true so direct callers get a
// uniform signature.
//
// Match scope mirrors what users expect from the search box:
//   - CTA headline, affected stations/direction
//   - observation segment endpoints, direction
//   - route/line keys *and* their human labels ("Red Line", "Route 66",
//     bus-route long names, signal-type labels). Without label matching,
//     "Green" wouldn't match key `g`, and "headway gaps" wouldn't match
//     observations carrying `signals: ['gap']`.
/**
 * @param {string} query
 * @returns {{ hasSearch: boolean, matchesIncident: (incident: Incident) => boolean }}
 */
export function buildSearchMatchers(query) {
  const q = (query || '').trim().toLowerCase();
  const hasSearch = q.length > 0;
  if (!hasSearch) {
    return { hasSearch, matchesIncident: () => true };
  }
  const matchesLine = (key, kind) => {
    if (key == null) return false;
    const haystack = [String(key).toLowerCase()];
    if (kind === 'train') {
      const label = TRAIN_LINES[key]?.label?.toLowerCase();
      if (label) haystack.push(label, `${label} line`);
    } else if (kind === 'bus') {
      const lowerKey = String(key).toLowerCase();
      haystack.push(`route ${lowerKey}`, `#${lowerKey}`);
      const name = BUS_ROUTE_NAMES[key];
      if (name) haystack.push(name.toLowerCase());
    }
    return haystack.some((s) => s.includes(q));
  };
  const matchesIncident = (inc) => {
    // Route/line keys and their labels are carried at the incident top level.
    if ((inc.routes || []).some((r) => matchesLine(r, inc.kind))) return true;
    const c = inc.cta;
    if (c) {
      const fields = [
        c.headline,
        c.affected_from_station,
        c.affected_to_station,
        c.affected_direction,
      ].filter(Boolean);
      if (fields.some((s) => s.toLowerCase().includes(q))) return true;
    }
    for (const o of inc.observations || []) {
      const fields = [o.from_station, o.to_station, o.direction].filter((v) => v != null);
      if (fields.some((v) => String(v).toLowerCase().includes(q))) return true;
      for (const sig of observationSignals(o)) {
        if (sig.toLowerCase().includes(q)) return true;
        const label = SIGNAL_LABELS[sig];
        if (label?.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  };
  return { hasSearch, matchesIncident };
}

// Search-only filter: subset incidents to those whose searchable fields contain
// `query`. Inputs are expected to already be scoped to the caller's view
// (LinePage, StationPage); this just narrows by free text and uses the same
// matcher as `filterIncidents` so the search box behaves identically everywhere.
/**
 * @param {Incident[]} incidents
 * @param {string} query
 * @returns {Incident[]}
 */
export function searchFilterIncidents(incidents, query) {
  const { hasSearch, matchesIncident } = buildSearchMatchers(query);
  if (!hasSearch) return incidents;
  return incidents.filter(matchesIncident);
}

// Filter incidents by selected train lines, bus toggle, signal kinds, source
// bucket, free-text search, and a start timestamp / pinned day. Active incidents
// bypass the timestamp filter so they always appear. Bus incidents are
// controlled independently of the train line filter — selecting Red Line
// doesn't hide bus incidents when showBus=true.
/**
 * @param {Incident[]} incidents
 * @param {object} [options]
 * @param {string[] | null} [options.lines]    null = all train lines. Empty array = no train lines.
 * @param {number | null} [options.startTs]    Drop incidents older than this (active ones bypass).
 * @param {boolean} [options.showBus]
 * @param {string[] | null} [options.busRoutes] When non-empty, restrict bus incidents to these routes.
 * @param {string[] | null} [options.metraLines] When non-empty, restrict Metra incidents to these lines.
 * @param {number | null} [options.selectedDay] Chicago-day UTC midnight; when set, only incidents
 *   whose [start, end] span overlaps this day pass. Overrides startTs.
 * @param {string[] | null} [options.signals]  When non-empty, keep only incidents with an
 *   observation carrying one of these signal kinds. CTA-only incidents (no observations) drop.
 * @param {string[] | null} [options.sources]  When shorter than SOURCE_TYPES, keep only incidents
 *   whose source bucket (cta/bot/merged) is selected.
 * @param {string} [options.search] Free-text search across CTA + observation fields.
 * @param {number} [options.now]               For selectedDay span calc; defaults to Date.now().
 * @returns {Incident[]}
 */
export function filterIncidents(
  incidents,
  {
    lines,
    startTs,
    showBus = true,
    busRoutes = null,
    metraLines = null,
    selectedDay = null,
    signals = null,
    sources = null,
    search = '',
    agencies = null,
    now = Date.now(),
  } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;
  const hasMetraLineFilter = metraLines && metraLines.length > 0;
  const hasSignalFilter = signals && signals.length > 0;
  const signalSet = hasSignalFilter ? new Set(signals) : null;
  const hasSourceFilter = sources && sources.length < SOURCE_TYPES.length;
  const sourceSet = hasSourceFilter ? new Set(sources) : null;
  // Agency = 'metra' for kind==='metra', else 'cta' (train + bus). The agency
  // filter (shown only in the ?metra=1 preview) scopes the feed to one agency.
  const hasAgencyFilter = agencies && agencies.length > 0 && agencies.length < 2;
  const agencySet = hasAgencyFilter ? new Set(agencies) : null;
  const { hasSearch, matchesIncident } = buildSearchMatchers(search);

  // When selectedDay is pinned, an incident matches iff its [start, end] span
  // overlaps that calendar day. Active incidents (no resolved_ts) extend to
  // `now`, so a still-open disruption shows up on every day from its start
  // through today.
  const overlapsSelectedDay = (start, end) => {
    if (selectedDay == null) return true;
    const s = chicagoDayUTC(start);
    const e = chicagoDayUTC(end || now);
    return selectedDay >= s && selectedDay <= e;
  };

  return (incidents || []).filter((inc) => {
    const agency = inc.kind === 'metra' ? 'metra' : 'cta';
    if (agencySet && !agencySet.has(agency)) return false;
    // The CTA line/bus filters apply only to CTA incidents — a Red Line selection
    // shouldn't hide Metra. Metra has its own line filter; the agency control
    // governs cross-agency visibility.
    if (agency === 'cta') {
      if (inc.kind === 'bus') {
        if (!showBus) return false;
        if (hasBusRouteFilter && !(inc.routes || []).some((r) => busRoutes.includes(r))) {
          return false;
        }
      } else if (hasLineFilter && !(inc.routes || []).some((r) => lines.includes(r))) {
        return false;
      }
    } else if (hasMetraLineFilter && !(inc.routes || []).some((r) => metraLines.includes(r))) {
      // agency === 'metra'
      return false;
    }
    // Signal filter keeps an incident when any of its observations carries a
    // matching kind. CTA-only incidents have no observations, so they drop —
    // the same "bot-detected only" intent as before, applied atomically (a
    // CTA+bot incident with a matching detection stays whole rather than being
    // demoted to its bot half).
    if (hasSignalFilter) {
      const obs = inc.observations || [];
      if (!obs.some((o) => observationSignals(o).some((s) => signalSet.has(s)))) return false;
    }
    if (hasSourceFilter && !sourceSet.has(incidentSource(inc))) return false;
    if (hasSearch && !matchesIncident(inc)) return false;
    if (selectedDay != null) {
      return overlapsSelectedDay(inc.first_seen_ts, inc.resolved_ts);
    }
    if (startTs && inc.first_seen_ts < startTs && !inc.active) return false;
    return true;
  });
}
