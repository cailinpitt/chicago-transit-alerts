// Merging and filtering logic for the alerts + observations feed.
// "Merging" pairs an official CTA alert with a matching bot observation on the
// same line within a 2-hour window so the two sources don't double-count.

import { BUS_ROUTE_NAMES } from './busRoutes.js';
import { normalizeTrainLine, TRAIN_LINES } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';

// Normalize line keys on alerts/observations from the cta-bot JSON. Bot data
// uses CTA's short codes ('g', 'org', 'p', 'brn', 'y'); the rest of the UI
// uses full names ('green', 'orange', etc.). Run this once at the fetch
// boundary so downstream code never has to think about it.
/**
 * @param {AlertsPayload} payload
 * @returns {AlertsPayload}
 */
export function normalizeAlertsPayload(payload) {
  if (!payload) return payload;
  return {
    ...payload,
    alerts: (payload.alerts || []).map((a) =>
      a.kind === 'train' && Array.isArray(a.routes)
        ? { ...a, routes: a.routes.map(normalizeTrainLine) }
        : a,
    ),
    observations: (payload.observations || []).map((o) =>
      o.kind === 'train' && o.line ? { ...o, line: normalizeTrainLine(o.line) } : o,
    ),
  };
}

/**
 * Top-level payload served by `public/data/alerts.json`. Regenerated server-
 * side every ~7 minutes by the cta-bot pipeline.
 *
 * @typedef {object} AlertsPayload
 * @property {number} generated_at  Epoch ms when the snapshot was produced.
 * @property {number} data_start_ts Earliest moment we have coverage for; days
 *   before this are rendered as "no data" rather than "no incidents".
 * @property {Alert[]} alerts
 * @property {Observation[]} observations
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
 * @property {string | null} [direction]
 * @property {string | null} [from_station]
 * @property {string | null} [to_station]
 * @property {'roundup' | string} [detection_source]  'roundup' = multi-signal correlation.
 * @property {string[]} [signals]           Signal sources for roundups: 'gap', 'bunching', 'ghost', 'pulse-cold', 'pulse-held'.
 * @property {number} ts                    Detection time. Treated as the start.
 * @property {number | null} resolved_ts
 * @property {number | null} [duration_ms]
 * @property {boolean} active
 * @property {string} [post_url]
 * @property {string | null} [resolved_post_url]
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
};

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

// Canonical event id for an incident: the alert post's rkey when present, else
// the observation post's rkey. The alert post is preferred so a merged record
// shares its id with the standalone alert from before the merge happened.
/**
 * @param {object} incident An Alert, Observation, or MergedIncident.
 * @returns {string | null}
 */
export function getEventId(incident) {
  if (!incident) return null;
  return postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url) ?? null;
}

// Format a multi-route/multi-line label for display. Single-route bus alerts
// keep their verbose `#3 King Drive` name; multi-route alerts collapse to
// the bare numbers (e.g. `#136, #147, #151`) so the label stays short
// enough for headings and OG cards. 4+ routes wrap as `first two + N more`
// or `N train lines`.
/**
 * @param {'train'|'bus'} kind
 * @param {string[]} routes
 * @returns {string}
 */
export function formatRoutesLabel(kind, routes) {
  if (!routes || routes.length === 0) return kind === 'train' ? 'this line' : 'this route';
  if (kind === 'train') {
    const labels = routes.map((r) => TRAIN_LINES[r]?.label ?? r);
    if (labels.length === 1) return `${labels[0]} Line`;
    if (labels.length === 2) return `${labels[0]} and ${labels[1]} Lines`;
    if (labels.length === 3) return `${labels[0]}, ${labels[1]}, and ${labels[2]} Lines`;
    return `${labels.length} train lines`;
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

// Find an incident by event id across the full payload. Searches alerts first
// (so a merged record resolves through its alert post id), then standalone
// observations. The merge step mirrors what IncidentList renders so a shared
// link lands on the same combined view the user copied it from.
/**
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @param {string} id
 * @returns {(MergedIncident | Alert | Observation) & { _type?: string } | null}
 */
export function findIncidentById(alerts, observations, id) {
  if (!id) return null;
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);
  const fromMerged = merged.find(
    (m) =>
      postUrlRkey(m.post_url) === id ||
      postUrlRkey(m.obs_post_url) === id ||
      (m.extra_obs ?? []).some((e) => postUrlRkey(e.post_url) === id),
  );
  if (fromMerged) return fromMerged;
  const fromAlert = standaloneAlerts.find((a) => postUrlRkey(a.post_url) === id);
  if (fromAlert) return fromAlert;
  const fromObs = standaloneObs.find((o) => postUrlRkey(o.post_url) === id);
  if (fromObs) return fromObs;
  return null;
}

// Routes (or single line) an incident affects. Alerts/merged records carry a
// plural `routes`; standalone observations carry a singular `line`. Bus
// observations use bus route numbers; train observations use line keys.
function incidentRoutes(incident) {
  if (!incident) return [];
  if (Array.isArray(incident.routes) && incident.routes.length > 0) return incident.routes;
  if (incident.line) return [incident.line];
  return [];
}

// Find incidents on the same line(s) within ±windowMs of the given incident,
// excluding the incident itself. Used by the event detail page to show
// surrounding context — was this disruption isolated, or part of a cluster of
// problems on the same line?
/**
 * @param {object} incident
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @param {number} [windowMs] Time window before/after; defaults to 24h.
 * @returns {Array<MergedIncident | Alert | Observation>} Sorted newest-first, excluding self.
 */
export function findRelatedIncidents(
  incident,
  alerts,
  observations,
  windowMs = 24 * 60 * 60 * 1000,
) {
  if (!incident) return [];
  const routes = new Set(incidentRoutes(incident));
  if (routes.size === 0) return [];
  const kind = incident.kind;
  const ts = incident.first_seen_ts ?? incident.ts;
  if (ts == null) return [];
  const lo = ts - windowMs;
  const hi = ts + windowMs;
  const selfId = postUrlRkey(incident.post_url);

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  const overlapsRoute = (other) => {
    if (other.kind !== kind) return false;
    return incidentRoutes(other).some((r) => routes.has(r));
  };
  const inWindow = (other) => {
    const t = other.first_seen_ts ?? other.ts;
    return t != null && t >= lo && t <= hi;
  };
  const isSelf = (other) => {
    const id = postUrlRkey(other.post_url);
    return id != null && id === selfId;
  };

  const out = [];
  for (const m of merged) {
    if (!overlapsRoute(m) || !inWindow(m) || isSelf(m)) continue;
    out.push(m);
  }
  for (const a of standaloneAlerts) {
    if (!overlapsRoute(a) || !inWindow(a) || isSelf(a)) continue;
    out.push(a);
  }
  for (const o of standaloneObs) {
    if (!overlapsRoute(o) || !inWindow(o) || isSelf(o)) continue;
    out.push(o);
  }

  out.sort((a, b) => (b.first_seen_ts ?? b.ts) - (a.first_seen_ts ?? a.ts));
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
 * @param {object} incident
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @param {number} [windowMs] Time window before/after; defaults to 1h.
 * @returns {Array<MergedIncident | Alert | Observation>}
 */
export function findContemporaneousOnOtherLines(
  incident,
  alerts,
  observations,
  windowMs = 60 * 60 * 1000,
) {
  if (!incident) return [];
  const selfRoutes = new Set(incidentRoutes(incident));
  const selfKind = incident.kind;
  const ts = incident.first_seen_ts ?? incident.ts;
  if (ts == null) return [];
  const lo = ts - windowMs;
  const hi = ts + windowMs;
  const selfId = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  const inWindow = (other) => {
    const t = other.first_seen_ts ?? other.ts;
    return t != null && t >= lo && t <= hi;
  };
  const overlapsSelfRoutes = (other) => {
    // For trains: any shared line key disqualifies (it's the same line, the
    // RelatedIncidents section already covers that). For buses: same logic
    // on route numbers. Cross-kind (train vs bus) is always considered
    // different because the route key spaces are disjoint.
    if (other.kind !== selfKind) return false;
    return incidentRoutes(other).some((r) => selfRoutes.has(r));
  };
  const isSelf = (other) => {
    const id = postUrlRkey(other.post_url) ?? postUrlRkey(other.obs_post_url);
    return id != null && id === selfId;
  };

  const out = [];
  for (const m of merged) {
    if (!inWindow(m) || isSelf(m)) continue;
    if (overlapsSelfRoutes(m)) continue;
    out.push(m);
  }
  for (const a of standaloneAlerts) {
    if (!inWindow(a) || isSelf(a)) continue;
    if (overlapsSelfRoutes(a)) continue;
    out.push(a);
  }
  for (const o of standaloneObs) {
    if (!inWindow(o) || isSelf(o)) continue;
    if (overlapsSelfRoutes(o)) continue;
    out.push(o);
  }

  out.sort((a, b) => (b.first_seen_ts ?? b.ts) - (a.first_seen_ts ?? a.ts));
  return out;
}

// Merge bot observations into their matching official CTA alerts when they
// share the same line and overlapping time window. Returns:
//   merged           — combined alert+observation records
//   standaloneAlerts — alerts with no matching observation
//   standaloneObs    — observations with no matching alert
/**
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @returns {{ merged: MergedIncident[], standaloneAlerts: Alert[], standaloneObs: Observation[] }}
 */
export function mergeMatchingIncidents(alerts, observations) {
  const BUFFER_MS = 2 * 60 * 60 * 1000; // 2-hour window on each side

  const usedObsIds = new Set();
  const usedAlertIds = new Set();
  const merged = [];

  for (const alert of alerts) {
    // Collect every observation that overlaps this alert's window. A single
    // outage commonly trips multiple detectors (pulse-cold + roundup, etc.);
    // taking only the first match left the others orphaned as standalone
    // cards that read as a separate incident.
    const matches = [];
    for (const obs of observations) {
      if (usedObsIds.has(obs.id)) continue;
      if (alert.kind !== obs.kind) continue;
      if (!alert.routes.includes(obs.line)) continue;
      // Anchor on first_seen_ts only. Stretching the window across the alert's
      // entire lifespan let multi-day planned alerts vacuum up unrelated
      // observations from later days as if they were the same incident.
      if (Math.abs(obs.ts - alert.first_seen_ts) > BUFFER_MS) continue;
      // Require the obs and alert intervals to actually overlap (with a small
      // grace). Without this, a bot observation that fully resolved before the
      // alert fired — or fired after the alert already cleared — could still
      // satisfy the ±2h proximity test and get merged onto an unrelated
      // alert, surfacing bot post links into a different thread.
      const obsEnd = obs.resolved_ts ?? obs.ts;
      const alertEnd = alert.resolved_ts ?? Number.POSITIVE_INFINITY;
      const GRACE_MS = 10 * 60 * 1000;
      if (obsEnd + GRACE_MS < alert.first_seen_ts) continue;
      if (alertEnd + GRACE_MS < obs.ts) continue;
      matches.push(obs);
    }
    if (matches.length === 0) continue;

    // Primary obs = the one closest in time to the alert (most likely the
    // detection that caught the same onset CTA published). The existing
    // single-obs schema (obs_post_url, from_station, …) reflects this
    // primary; the rest ride along on extra_obs so routing and the UI can
    // still reach them.
    matches.sort(
      (a, b) => Math.abs(a.ts - alert.first_seen_ts) - Math.abs(b.ts - alert.first_seen_ts),
    );
    const primary = matches[0];
    const extras = matches.slice(1);
    // While the incident is active, the obs's prior resolution doesn't end
    // the incident — surfacing it would produce a "last seen" before
    // "first seen" and a misleading "Bot resolution" link on an ongoing
    // event. Suppress resolution-side fields until the alert resolves.
    const active = alert.active || matches.some((o) => o.active);
    merged.push({
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
      // Carry CTA's claimed event-end through so EventPage can compare
      // their stated end to the actual resolve timestamp. Survives even
      // when CTA later scrubs the alert (the field is persisted at
      // first-sighting in the pipeline).
      cta_event_start_ts: alert.cta_event_start_ts ?? null,
      cta_event_end_ts: alert.cta_event_end_ts ?? null,
      cta_event_start_is_date_only: alert.cta_event_start_is_date_only === true,
      cta_event_end_is_date_only: alert.cta_event_end_is_date_only === true,
      from_station: primary.from_station,
      to_station: primary.to_station,
      obs_post_url: primary.post_url,
      obs_resolved_post_url: active ? null : primary.resolved_post_url,
      // Surface the observation's own clear timestamp on merged records.
      // The bot's resolved_ts requires sustained recovery (CLEAR_TICKS_TO_RESET
      // consecutive clean passes) before firing, so when both the CTA
      // alert and the bot have resolved, comparing alert.resolved_ts (CTA
      // marked the alert cleared) to obs.resolved_ts (trains running
      // again) gives a service-stabilization delta. Null while active to
      // avoid the same "last seen before first seen" hazard handled above.
      obs_resolved_ts: active ? null : (primary.resolved_ts ?? null),
      obs_ts: primary.ts,
      obs_id: primary.id,
      // Carry the observation's typing info onto the merged record so
      // downstream consumers (e.g. typical-duration cohorts) can bucket
      // by signal without re-resolving the observation by id.
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
    });
    for (const o of matches) usedObsIds.add(o.id);
    usedAlertIds.add(alert.alert_id);
  }

  return {
    merged,
    standaloneAlerts: alerts.filter((a) => !usedAlertIds.has(a.alert_id)),
    standaloneObs: observations.filter((o) => !usedObsIds.has(o.id)),
  };
}

// Filter alerts and observations by selected train lines, bus toggle, and a
// start timestamp. Active incidents bypass the timestamp filter so they always
// appear. Bus observations are controlled independently of the train line
// filter — selecting Red Line doesn't hide bus observations when showBus=true.
/**
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @param {object} [options]
 * @param {string[] | null} [options.lines]    null = all train lines. Empty array = no train lines.
 * @param {number | null} [options.startTs]    Drop incidents older than this (active ones bypass).
 * @param {boolean} [options.showBus]
 * @param {string[] | null} [options.busRoutes] When non-empty, restrict bus observations to these routes.
 * @param {number | null} [options.selectedDay] Chicago-day UTC midnight; when set, only incidents
 *   whose [start, end] span overlaps this day pass. Overrides startTs.
 * @param {string[] | null} [options.signals]  When non-empty, restrict observations to those
 *   carrying any of the given signal kinds. Standalone alerts (no signals) are dropped.
 * @param {string} [options.search] Free-text search; case-insensitive substring match against
 *   alert headlines, observation from/to/affected stations, and direction.
 * @param {number} [options.now]               For selectedDay span calc; defaults to Date.now().
 * @returns {{ alerts: Alert[], observations: Observation[] }}
 */
// Build the per-incident text matchers used by both `filterIncidents` and
// `searchFilterIncidents`. Returned as `{ matchesAlert, matchesObservation }`;
// when the query is blank both matchers return true (hasSearch=false caller
// path skips them in `filterIncidents`, but the sentinel keeps the signature
// uniform for direct callers).
//
// Match scope mirrors what users expect from the search box:
//   - alert headline, affected stations/direction
//   - observation segment endpoints, direction
//   - route/line keys *and* their human labels ("Red Line", "Route 66",
//     bus-route long names, signal-type labels). Without label matching,
//     "Green" wouldn't match key `g`, and "headway gaps" wouldn't match
//     observations carrying `signals: ['gap']`.
/**
 * @param {string} query
 * @returns {{
 *   hasSearch: boolean,
 *   matchesAlert: (alert: Alert) => boolean,
 *   matchesObservation: (obs: Observation) => boolean,
 * }}
 */
export function buildSearchMatchers(query) {
  const q = (query || '').trim().toLowerCase();
  const hasSearch = q.length > 0;
  if (!hasSearch) {
    return { hasSearch, matchesAlert: () => true, matchesObservation: () => true };
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
  const matchesAlert = (a) => {
    const fields = [
      a.headline,
      a.affected_from_station,
      a.affected_to_station,
      a.affected_direction,
    ].filter(Boolean);
    if (fields.some((s) => s.toLowerCase().includes(q))) return true;
    return (a.routes || []).some((r) => matchesLine(r, a.kind));
  };
  const matchesObservation = (o) => {
    const fields = [o.from_station, o.to_station, o.direction].filter((v) => v != null);
    if (fields.some((v) => String(v).toLowerCase().includes(q))) return true;
    if (matchesLine(o.line, o.kind)) return true;
    for (const sig of observationSignals(o)) {
      if (sig.toLowerCase().includes(q)) return true;
      const label = SIGNAL_LABELS[sig];
      if (label?.toLowerCase().includes(q)) return true;
    }
    return false;
  };
  return { hasSearch, matchesAlert, matchesObservation };
}

// Search-only filter: subset alerts/observations to those whose searchable
// fields contain `query`. Inputs are expected to already be scoped to the
// caller's view (LinePage, StationPage); this just narrows by free text and
// uses the same matchers as `filterIncidents` so the search box behaves
// identically across pages.
/**
 * @param {Alert[]} alerts
 * @param {Observation[]} observations
 * @param {string} query
 * @returns {{ alerts: Alert[], observations: Observation[] }}
 */
export function searchFilterIncidents(alerts, observations, query) {
  const { hasSearch, matchesAlert, matchesObservation } = buildSearchMatchers(query);
  if (!hasSearch) return { alerts, observations };
  return {
    alerts: alerts.filter(matchesAlert),
    observations: observations.filter(matchesObservation),
  };
}

export function filterIncidents(
  alerts,
  observations,
  {
    lines,
    startTs,
    showBus = true,
    busRoutes = null,
    selectedDay = null,
    signals = null,
    sources = null,
    search = '',
    now = Date.now(),
  } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;
  const hasSignalFilter = signals && signals.length > 0;
  const signalSet = hasSignalFilter ? new Set(signals) : null;
  const { hasSearch, matchesAlert, matchesObservation } = buildSearchMatchers(search);

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

  const filteredAlerts = alerts.filter((a) => {
    // Signal filter is "show only bot-detected disruptions of these kinds";
    // CTA alerts have no signal, so they're hidden whenever a signal filter
    // is active. (A merged record's matching observation is checked separately
    // via filteredObs — the IncidentList re-merges from these results.)
    if (hasSignalFilter) return false;
    if (a.kind === 'bus') {
      if (!showBus) return false;
      if (hasBusRouteFilter && !a.routes.some((r) => busRoutes.includes(r))) return false;
    } else if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
    if (hasSearch && !matchesAlert(a)) return false;
    if (selectedDay != null) {
      return overlapsSelectedDay(a.first_seen_ts, a.resolved_ts);
    }
    if (startTs && a.first_seen_ts < startTs && !a.active) return false;
    return true;
  });

  const filteredObs = observations.filter((o) => {
    const isBus = o.kind === 'bus';
    if (isBus) {
      if (!showBus) return false;
      if (hasBusRouteFilter && !busRoutes.includes(o.line)) return false;
    } else {
      if (hasLineFilter && !lines.includes(o.line)) return false;
    }
    if (hasSignalFilter) {
      const sigs = observationSignals(o);
      if (!sigs.some((s) => signalSet.has(s))) return false;
    }
    if (hasSearch && !matchesObservation(o)) return false;
    if (selectedDay != null) {
      return overlapsSelectedDay(o.ts, o.resolved_ts);
    }
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  // Source filter (CTA / bot / merged). "merged" is a post-merge category, so
  // we run the same pairing the renderer does and then keep only the alerts
  // and observations that fall into a selected bucket. Skipped only when
  // every category is selected — that's the default "show everything"
  // state. An empty `sources` array means "show nothing" (user toggled all
  // chips off) and falls through the same code path with empty keep-sets.
  if (sources && sources.length < SOURCE_TYPES.length) {
    const want = new Set(sources);
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      filteredAlerts,
      filteredObs,
    );
    const keepAlertIds = new Set();
    const keepObsIds = new Set();
    if (want.has('merged')) {
      for (const m of merged) {
        keepAlertIds.add(m.alert_id);
        keepObsIds.add(m.obs_id);
        // Multi-detection incidents carry extra observations alongside the
        // primary; retain them so the downstream re-merge in IncidentList
        // can reassemble the full merged record instead of dropping them
        // into the standalone bucket (where the source filter would hide
        // them again).
        if (Array.isArray(m.extra_obs)) {
          for (const e of m.extra_obs) keepObsIds.add(e.id);
        }
      }
    }
    if (want.has('cta')) {
      for (const a of standaloneAlerts) keepAlertIds.add(a.alert_id);
    }
    if (want.has('bot')) {
      for (const o of standaloneObs) keepObsIds.add(o.id);
    }
    return {
      alerts: filteredAlerts.filter((a) => keepAlertIds.has(a.alert_id)),
      observations: filteredObs.filter((o) => keepObsIds.has(o.id)),
    };
  }

  return { alerts: filteredAlerts, observations: filteredObs };
}
