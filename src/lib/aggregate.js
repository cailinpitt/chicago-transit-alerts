// Aggregation helpers — turn the raw alerts/observations feed into the shapes
// the timeline grid and the at-a-glance summary line need.

import { TRAIN_LINE_ORDER } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';
import { mergeMatchingIncidents, observationSignals, SIGNAL_TYPES } from './incidents.js';

const CHICAGO_TZ = 'America/Chicago';
const chicagoHourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO_TZ,
  weekday: 'short',
  hour: 'numeric',
  hour12: false,
});

// 'Sun' (system locale) → 0 ... 'Sat' → 6, matching JS Date conventions so
// callers can index with the same model they already use elsewhere.
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function chicagoWeekdayHour(ts) {
  let weekday = null;
  let hour = null;
  for (const p of chicagoHourFmt.formatToParts(new Date(ts))) {
    if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value];
    else if (p.type === 'hour') hour = Number(p.value);
  }
  // Intl renders midnight as '24' under hour12:false in some Node/ICU builds.
  if (hour === 24) hour = 0;
  return { weekday, hour };
}

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
// Returns { aggregate, byRoute, topRoutes, otherAggregate }
//   - aggregate: { dayIdx: distinctRouteCount } across all routes
//   - byRoute:   { routeId: { dayIdx: count } }
//   - topRoutes: routeIds sorted by total incidents desc, capped at topN
//   - otherAggregate: { dayIdx: distinctRouteCount } excluding topRoutes
// Distinct-route counts are used (not raw event counts) so the color reflects
// breadth of impact across the system.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [numDays]
 * @param {number} [now]
 * @param {number} [topN]
 * @returns {{
 *   aggregate: Object<number, number>,
 *   byRoute: Object<string, Object<number, number>>,
 *   topRoutes: string[],
 *   otherAggregate: Object<number, number>,
 * }}
 */
export function buildBusIncidentsByDay(
  alerts,
  observations,
  numDays = 90,
  now = Date.now(),
  topN = 5,
) {
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

  // Merge to avoid double-counting bus incidents that have both a CTA alert
  // and a matching bot observation on the same route.
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    alerts.filter((a) => a.kind === 'bus'),
    observations.filter((o) => o.kind === 'bus'),
  );

  for (const m of merged) {
    for (const route of m.routes) addSpan(route, m.first_seen_ts, m.resolved_ts);
  }
  for (const a of standaloneAlerts) {
    for (const route of a.routes) addSpan(route, a.first_seen_ts, a.resolved_ts);
  }
  for (const o of standaloneObs) {
    addSpan(o.line, o.ts, o.resolved_ts);
  }

  const aggregate = {};
  for (const [d, routes] of Object.entries(routesPerDay)) {
    aggregate[Number(d)] = routes.size;
  }

  // Rank routes by total incidents within the visible window, then take topN.
  const totals = Object.entries(byRoute).map(([routeId, days]) => {
    let sum = 0;
    for (const c of Object.values(days)) sum += c;
    return [routeId, sum];
  });
  totals.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const topRoutes = totals.slice(0, topN).map(([id]) => id);
  const topSet = new Set(topRoutes);

  const otherAggregate = {};
  for (const [d, routes] of Object.entries(routesPerDay)) {
    let n = 0;
    for (const r of routes) if (!topSet.has(r)) n++;
    if (n > 0) otherAggregate[Number(d)] = n;
  }

  return { aggregate, byRoute, topRoutes, otherAggregate };
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
 *   quietestLineId: string | null,
 *   quietestLineDays: number,
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

  // Quietest line: among the eight train lines, find the one whose most
  // recent incident is the oldest (longest streak of clean days). Buses are
  // excluded — there are too many low-traffic routes for "Route 192: 60 days
  // since last incident" to be meaningful, and that's not the kind of brag
  // riders care about anyway.
  const lastTsByLine = new Map();
  for (const inc of incidents) {
    if (inc.kind !== 'train') continue;
    for (const line of inc.lines || []) {
      if (!TRAIN_LINE_ORDER.includes(line)) continue;
      const prev = lastTsByLine.get(line);
      if (prev == null || inc.ts > prev) lastTsByLine.set(line, inc.ts);
    }
  }
  let quietestLineId = null;
  let quietestLineDays = 0;
  for (const line of TRAIN_LINE_ORDER) {
    const ts = lastTsByLine.get(line);
    if (ts == null) continue; // no data for this line — skip rather than guess at the streak
    const days = Math.floor((now - ts) / DAY_MS);
    if (days > quietestLineDays) {
      quietestLineDays = days;
      quietestLineId = line;
    }
  }

  return {
    activeCount,
    weeklyCount,
    mostAffectedKind: mostAffected?.kind ?? null,
    mostAffectedId: mostAffected?.id ?? null,
    mostAffectedCount: mostAffected?.count ?? 0,
    quietestLineId,
    quietestLineDays,
  };
}

// Build a 7×24 grid of incident counts, indexed [weekday][hour] where weekday
// 0 = Sunday and hour 0 = midnight (Chicago local time). Buckets by start
// timestamp — a multi-hour incident counts once at its start, matching how
// the contributions grid handles ongoing spans.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @returns {{ grid: number[][], maxCount: number, total: number }}
 */
export function buildHourOfWeek(alerts, observations) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let maxCount = 0;
  let total = 0;

  function bump(ts) {
    if (!ts) return;
    const { weekday, hour } = chicagoWeekdayHour(ts);
    if (weekday == null || hour == null) return;
    grid[weekday][hour] += 1;
    total += 1;
    if (grid[weekday][hour] > maxCount) maxCount = grid[weekday][hour];
  }

  // Merge to avoid double-counting alert+observation pairs.
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);
  for (const m of merged) bump(m.first_seen_ts);
  for (const a of standaloneAlerts) bump(a.first_seen_ts);
  for (const o of standaloneObs) bump(o.first_seen_ts || o.ts);

  return { grid, maxCount, total };
}

// Build per-train-line signal-type counts for the breakdown stacked bars.
// Returns { lineId: { gap: n, bunching: n, ... }, totals: { gap: n, ... } }.
// Bus routes are excluded because there are too many to chart usefully — the
// per-line breakdown is most legible for the eight train lines.
/**
 * @param {import('./incidents.js').Observation[]} observations
 * @returns {{ byLine: Object<string, Object<string, number>>, totals: Object<string, number> }}
 */
export function buildSignalsByLine(observations) {
  const byLine = {};
  const totals = {};
  for (const sig of SIGNAL_TYPES) totals[sig] = 0;
  for (const line of TRAIN_LINE_ORDER) {
    byLine[line] = {};
    for (const sig of SIGNAL_TYPES) byLine[line][sig] = 0;
  }

  for (const o of observations) {
    if (o.kind !== 'train') continue;
    if (!TRAIN_LINE_ORDER.includes(o.line)) continue;
    for (const sig of observationSignals(o)) {
      if (!(sig in totals)) continue;
      byLine[o.line][sig] += 1;
      totals[sig] += 1;
    }
  }

  return { byLine, totals };
}
