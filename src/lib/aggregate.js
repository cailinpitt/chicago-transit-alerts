// Aggregation helpers — turn the raw alerts/observations feed into the shapes
// the timeline grid and the at-a-glance summary line need.

import { TRAIN_LINE_ORDER } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';
import { mergeMatchingIncidents } from './incidents.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Build a map of lineId -> { dayIdx: incidentCount } for the timeline grid.
// dayIdx 0 = today, 1 = yesterday, ..., numDays-1 = oldest day shown.
// Only includes train lines (bus incidents appear in the list but not the grid).
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [numDays]
 * @param {number} [now]
 * @returns {Object<string, Object<number, number>>} lineId -> dayIdx -> count
 */
export function buildIncidentsByDay(alerts, observations, numDays = 90, now = Date.now()) {
  const result = {};
  const todayUTC = chicagoDayUTC(now);

  function addSpan(lineId, startTs, endTs) {
    if (!TRAIN_LINE_ORDER.includes(lineId)) return;
    if (!result[lineId]) result[lineId] = {};

    const end = endTs || now;
    const startDayIdx = Math.round((todayUTC - chicagoDayUTC(startTs)) / DAY_MS);
    const endDayIdx = Math.round((todayUTC - chicagoDayUTC(end)) / DAY_MS);

    const lo = Math.max(0, endDayIdx);
    const hi = Math.min(numDays - 1, startDayIdx);
    for (let d = lo; d <= hi; d++) {
      result[lineId][d] = (result[lineId][d] || 0) + 1;
    }
  }

  // Use merge logic to avoid double-counting incidents that have both an alert
  // and a matching observation (e.g. a combined Green line incident).
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    alerts.filter((a) => a.kind === 'train'),
    observations.filter((o) => o.kind === 'train'),
  );

  for (const m of merged) {
    for (const route of m.routes) {
      addSpan(route, m.first_seen_ts, m.resolved_ts);
    }
  }

  for (const a of standaloneAlerts) {
    for (const route of a.routes) {
      addSpan(route, a.first_seen_ts, a.resolved_ts);
    }
  }

  for (const o of standaloneObs) {
    addSpan(o.line, o.ts, o.resolved_ts);
  }

  return result;
}

// Build bus incident counts for the timeline grid.
// Returns { aggregate: { dayIdx: distinctRouteCount }, byRoute: { routeId: { dayIdx: count } } }
// The aggregate counts how many distinct routes had incidents on each day, so the
// color reflects breadth of impact rather than raw event count.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [numDays]
 * @param {number} [now]
 * @returns {{ aggregate: Object<number, number>, byRoute: Object<string, Object<number, number>> }}
 */
export function buildBusIncidentsByDay(alerts, observations, numDays = 90, now = Date.now()) {
  const byRoute = {};
  const routesPerDay = {}; // { dayIdx: Set<routeId> } — for dedup in aggregate
  const todayUTC = chicagoDayUTC(now);

  function addSpan(routeId, startTs, endTs) {
    const key = String(routeId);
    if (!byRoute[key]) byRoute[key] = {};
    const end = endTs || now;
    const startDayIdx = Math.round((todayUTC - chicagoDayUTC(startTs)) / DAY_MS);
    const endDayIdx = Math.round((todayUTC - chicagoDayUTC(end)) / DAY_MS);
    const lo = Math.max(0, endDayIdx);
    const hi = Math.min(numDays - 1, startDayIdx);
    for (let d = lo; d <= hi; d++) {
      byRoute[key][d] = (byRoute[key][d] || 0) + 1;
      if (!routesPerDay[d]) routesPerDay[d] = new Set();
      routesPerDay[d].add(key);
    }
  }

  for (const a of alerts.filter((a) => a.kind === 'bus')) {
    for (const route of a.routes) addSpan(route, a.first_seen_ts, a.resolved_ts);
  }
  for (const o of observations.filter((o) => o.kind === 'bus')) {
    addSpan(o.line, o.ts, o.resolved_ts);
  }

  const aggregate = {};
  for (const [d, routes] of Object.entries(routesPerDay)) {
    aggregate[Number(d)] = routes.size;
  }

  return { aggregate, byRoute };
}

// Headline stats for the at-a-glance summary line. Always computed against
// the full dataset (not the filtered view) so the answer to "how's the CTA
// doing right now" doesn't change based on whatever the user has narrowed to.
// Uses merged incidents so a CTA alert and a matching bot observation count
// once, not twice. Most-affected uses a 30-day window for stability — a
// 7-day window flips around too much when one bad day dominates.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [now]
 * @returns {{
 *   activeCount: number,
 *   weeklyCount: number,
 *   mostAffectedKind: 'train' | 'bus' | null,
 *   mostAffectedId: string | null,
 *   mostAffectedCount: number,
 * }}
 */
export function computeSummaryStats(alerts, observations, now = Date.now()) {
  const weekAgo = now - 7 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  const incidents = [
    ...merged.map((m) => ({
      ts: m.first_seen_ts,
      kind: m.kind,
      lines: m.routes,
      active: m.active,
    })),
    ...standaloneAlerts.map((a) => ({
      ts: a.first_seen_ts,
      kind: a.kind,
      lines: a.routes,
      active: a.active,
    })),
    ...standaloneObs.map((o) => ({
      ts: o.first_seen_ts || o.ts,
      kind: o.kind,
      lines: [o.line],
      active: o.active,
    })),
  ];

  const activeCount = incidents.filter((i) => i.active).length;
  const weeklyCount = incidents.filter((i) => i.ts >= weekAgo).length;

  // Count last-30-day incidents per (kind, key) — train line key (e.g. "red")
  // or bus route number ("66"). Bus routes are included so the "most
  // affected" answer reflects reality even when a chronically-troubled bus
  // route outpaces every train line.
  const counts = new Map(); // key: `${kind}:${id}` -> { kind, id, count }
  for (const inc of incidents) {
    if (inc.ts < monthAgo) continue;
    if (inc.kind !== 'train' && inc.kind !== 'bus') continue;
    if (inc.kind === 'train') {
      for (const line of inc.lines || []) {
        if (!TRAIN_LINE_ORDER.includes(line)) continue;
        const key = `train:${line}`;
        const cur = counts.get(key) || { kind: 'train', id: line, count: 0 };
        cur.count++;
        counts.set(key, cur);
      }
    } else {
      for (const route of inc.lines || []) {
        const id = String(route);
        const key = `bus:${id}`;
        const cur = counts.get(key) || { kind: 'bus', id, count: 0 };
        cur.count++;
        counts.set(key, cur);
      }
    }
  }
  let mostAffected = null;
  for (const entry of counts.values()) {
    if (!mostAffected || entry.count > mostAffected.count) mostAffected = entry;
  }

  return {
    activeCount,
    weeklyCount,
    mostAffectedKind: mostAffected?.kind ?? null,
    mostAffectedId: mostAffected?.id ?? null,
    mostAffectedCount: mostAffected?.count ?? 0,
  };
}
