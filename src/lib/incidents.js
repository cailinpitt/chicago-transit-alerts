// Merging and filtering logic for the alerts + observations feed.
// "Merging" pairs an official CTA alert with a matching bot observation on the
// same line within a 2-hour window so the two sources don't double-count.

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
 * @property {string | null} [from_station]
 * @property {string | null} [to_station]
 * @property {string} [obs_post_url]
 * @property {number} obs_id
 */

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
          from_station: obs.from_station,
          to_station: obs.to_station,
          obs_post_url: obs.post_url,
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
 * @param {number} [options.now]               For selectedDay span calc; defaults to Date.now().
 * @returns {{ alerts: Alert[], observations: Observation[] }}
 */
export function filterIncidents(
  alerts,
  observations,
  { lines, startTs, showBus = true, busRoutes = null, selectedDay = null, now = Date.now() } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;

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
    if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
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
    if (selectedDay != null) {
      return overlapsSelectedDay(o.ts, o.resolved_ts);
    }
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  return { alerts: filteredAlerts, observations: filteredObs };
}
