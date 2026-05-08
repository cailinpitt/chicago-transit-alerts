// Merging and filtering logic for the alerts + observations feed.
// "Merging" pairs an official CTA alert with a matching bot observation on the
// same line within a 2-hour window so the two sources don't double-count.

import { BUS_ROUTE_NAMES } from './busRoutes.js';
import { TRAIN_LINES } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';

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
 */

// User-visible signal categories — the chips and stacked-bar segments.
// Order is the display order. Aligns with the cta-bot pipeline's pulse
// subtypes: an observation's detection_source is one of these (or 'roundup',
// in which case the precise signal kinds live in `signals`).
export const SIGNAL_TYPES = ['gap', 'bunching', 'ghost', 'pulse-cold', 'pulse-held'];

// Friendly labels for every signal kind. The `pulse` fallback covers any
// legacy snapshots written before export-web.js started emitting precise
// pulse subtypes — once data refreshes through the pipeline, only the
// subtype keys are seen.
export const SIGNAL_LABELS = {
  gap: 'headway gaps',
  bunching: 'bunching',
  ghost: 'missing vehicles',
  pulse: 'stalled service',
  'pulse-cold': 'cold stretch',
  'pulse-held': 'trains held in place',
};

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
  const fromMerged = merged.find((m) => postUrlRkey(m.post_url) === id);
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
    const alertEnd = (alert.resolved_ts || alert.last_seen_ts || Infinity) + BUFFER_MS;

    for (const obs of observations) {
      if (usedObsIds.has(obs.id)) continue;
      if (alert.kind !== obs.kind) continue;
      if (!alert.routes.includes(obs.line)) continue;

      const inWindow = obs.ts >= alert.first_seen_ts - BUFFER_MS && obs.ts <= alertEnd;

      if (inWindow) {
        merged.push({
          _type: 'merged',
          _sortTs: alert.first_seen_ts,
          alert_id: alert.alert_id,
          kind: alert.kind,
          routes: alert.routes,
          headline: alert.headline,
          first_seen_ts: alert.first_seen_ts,
          resolved_ts: alert.resolved_ts ?? obs.resolved_ts ?? null,
          active: alert.active || obs.active,
          post_url: alert.post_url,
          resolved_reply_url: alert.resolved_reply_url,
          affected_from_station: alert.affected_from_station,
          affected_to_station: alert.affected_to_station,
          affected_direction: alert.affected_direction,
          from_station: obs.from_station,
          to_station: obs.to_station,
          obs_post_url: obs.post_url,
          obs_resolved_post_url: obs.resolved_post_url,
          obs_id: obs.id,
        });
        usedObsIds.add(obs.id);
        usedAlertIds.add(alert.alert_id);
        break; // one observation per alert
      }
    }
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
    search = '',
    now = Date.now(),
  } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;
  const hasSignalFilter = signals && signals.length > 0;
  const signalSet = hasSignalFilter ? new Set(signals) : null;
  const q = (search || '').trim().toLowerCase();
  const hasSearch = q.length > 0;
  // Match a route/line key against the user-visible label as well as the raw
  // key. Includes the conversational forms riders actually type:
  // "Red Line" / "Brown Line" for trains, "Route 66" / "Chicago" for buses.
  // Without this, "Red" wouldn't match by accident of casing, "Green" wouldn't
  // match key 'g' at all, and "Red Line" or "Route 66" would miss entirely.
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
  const alertMatches = (a) => {
    const fields = [
      a.headline,
      a.affected_from_station,
      a.affected_to_station,
      a.affected_direction,
    ].filter(Boolean);
    if (fields.some((s) => s.toLowerCase().includes(q))) return true;
    return (a.routes || []).some((r) => matchesLine(r, a.kind));
  };
  const obsMatches = (o) => {
    const fields = [o.from_station, o.to_station, o.direction].filter((v) => v != null);
    if (fields.some((v) => String(v).toLowerCase().includes(q))) return true;
    if (matchesLine(o.line, o.kind)) return true;
    // Signal-type aliases. The chip filter is the primary way to narrow by
    // signal kind, but it's also natural to type the friendly label —
    // "headway gaps", "missing vehicles" — and have it work.
    for (const sig of observationSignals(o)) {
      if (sig.toLowerCase().includes(q)) return true;
      const label = SIGNAL_LABELS[sig];
      if (label && label.toLowerCase().includes(q)) return true;
    }
    return false;
  };

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
    if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
    if (hasSearch && !alertMatches(a)) return false;
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
    if (hasSearch && !obsMatches(o)) return false;
    if (selectedDay != null) {
      return overlapsSelectedDay(o.ts, o.resolved_ts);
    }
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  return { alerts: filteredAlerts, observations: filteredObs };
}
