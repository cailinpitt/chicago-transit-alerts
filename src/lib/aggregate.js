// Aggregation helpers — turn the raw alerts/observations feed into the shapes
// the timeline grid and the at-a-glance summary line need.

import { TRAIN_LINE_ORDER } from './ctaLines.js';
import { chicagoDayUTC } from './format.js';
import {
  mergeMatchingIncidents,
  observationSignals,
  postUrlRkey,
  SIGNAL_TYPES,
} from './incidents.js';
import { buildStationIndex } from './stations.js';

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

// Build per-day incident counts for the most recent `numDays` Chicago calendar
// days, plus a rolling 7-day average and a trend indicator comparing the most
// recent 7 days to the prior 7 days. Used by the homepage trend sparkline.
//
// `counts[i]` and `avg[i]` are indexed with i=0 = oldest day, i=numDays-1 =
// today — the sparkline reads naturally left-to-right as time progresses.
// Trend ratio is `recent7Avg / prior7Avg`; null when the prior window is zero
// (no baseline to compare against).
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [numDays]
 * @param {number} [now]
 * @returns {{
 *   counts: number[],
 *   avg: number[],
 *   recent7Avg: number,
 *   prior7Avg: number,
 *   trendRatio: number | null,
 * }}
 */
export function buildDailyTrend(alerts, observations, numDays = 30, now = Date.now()) {
  const todayUTC = chicagoDayUTC(now);
  // chronological array: index 0 = oldest, index numDays-1 = today.
  const counts = new Array(numDays).fill(0);

  function bump(ts) {
    if (ts == null) return;
    const dayIdx = numDays - 1 - Math.round((todayUTC - chicagoDayUTC(ts)) / DAY_MS);
    if (dayIdx >= 0 && dayIdx < numDays) counts[dayIdx] += 1;
  }

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);
  for (const m of merged) bump(m.first_seen_ts);
  for (const a of standaloneAlerts) bump(a.first_seen_ts);
  for (const o of standaloneObs) bump(o.first_seen_ts ?? o.ts);

  // Trailing 7-day average ending at each day (so avg[i] reflects the week
  // leading up to day i, including i itself). Earlier-than-7-days slots use
  // a shorter window — better than NaN, and lets the sparkline span the full
  // range without a leading dead zone.
  const avg = new Array(numDays).fill(0);
  for (let i = 0; i < numDays; i++) {
    const lo = Math.max(0, i - 6);
    let sum = 0;
    for (let j = lo; j <= i; j++) sum += counts[j];
    avg[i] = sum / (i - lo + 1);
  }

  // Compare the most recent 7 days to the 7 before that. With <14 days of
  // data both windows are partial; trendRatio is still meaningful because
  // both halves shrink symmetrically. With 0 in the prior window we return
  // null so callers can render "no baseline" rather than divide-by-zero.
  const recentLo = Math.max(0, numDays - 7);
  let recentSum = 0;
  for (let i = recentLo; i < numDays; i++) recentSum += counts[i];
  const recent7Avg = recentSum / (numDays - recentLo);
  const priorLo = Math.max(0, numDays - 14);
  const priorHi = Math.max(0, numDays - 7);
  let priorSum = 0;
  for (let i = priorLo; i < priorHi; i++) priorSum += counts[i];
  const priorWindowSize = priorHi - priorLo;
  const prior7Avg = priorWindowSize > 0 ? priorSum / priorWindowSize : 0;
  const trendRatio = prior7Avg > 0 ? recent7Avg / prior7Avg : null;

  return { counts, avg, recent7Avg, prior7Avg, trendRatio };
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
// Per-line reliability stats over a rolling window: how many of the last N
// Chicago-days had zero incident activity, and the typical cadence between
// incidents (median gap, start-to-start). Inputs are expected to be already
// filtered to a single line/route — the function does not filter further.
//
// `incidentFreeDays` counts Chicago-days within [today - windowDays + 1, today]
// that had no overlap with any incident span. An incident spanning multiple
// days subtracts from incident-free days for every day it touched, matching
// the way the timeline grid colors days. `medianGapHours` is null when fewer
// than 2 starts fall inside the window (no gap to take a median over).
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowDays]
 * @returns {{
 *   incidentFreeDays: number,
 *   totalDays: number,
 *   medianGapHours: number | null,
 *   longestStreakDays: number,
 * }}
 */
export function computeLineReliability(
  alerts,
  observations,
  { now = Date.now(), windowDays = 90 } = {},
) {
  const todayUTC = chicagoDayUTC(now);
  const cutoffDayUTC = todayUTC - (windowDays - 1) * DAY_MS;

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  const spans = []; // [startTs, endTs]
  const starts = [];

  function add(startTs, endTs) {
    spans.push([startTs, endTs ?? now]);
    starts.push(startTs);
  }

  for (const m of merged) add(m.first_seen_ts, m.resolved_ts);
  for (const a of standaloneAlerts) add(a.first_seen_ts, a.resolved_ts);
  for (const o of standaloneObs) add(o.ts, o.resolved_ts);

  const daysWithIncident = new Set();
  for (const [start, end] of spans) {
    const startDayIdx = Math.round((todayUTC - chicagoDayUTC(start)) / DAY_MS);
    const endDayIdx = Math.round((todayUTC - chicagoDayUTC(end)) / DAY_MS);
    const lo = Math.max(0, endDayIdx);
    const hi = Math.min(windowDays - 1, startDayIdx);
    for (let d = lo; d <= hi; d++) daysWithIncident.add(d);
  }

  const incidentFreeDays = windowDays - daysWithIncident.size;

  // Longest run of consecutive Chicago days within the window with no
  // incident on this line. Same dayIdx model as the contributions grid:
  // 0 = today, windowDays-1 = oldest day shown.
  let longestStreakDays = 0;
  let currentStreak = 0;
  for (let d = 0; d < windowDays; d++) {
    if (daysWithIncident.has(d)) {
      currentStreak = 0;
    } else {
      currentStreak += 1;
      if (currentStreak > longestStreakDays) longestStreakDays = currentStreak;
    }
  }

  const startsInWindow = starts.filter((t) => t >= cutoffDayUTC).sort((a, b) => a - b);
  let medianGapHours = null;
  if (startsInWindow.length >= 2) {
    const gaps = [];
    for (let i = 1; i < startsInWindow.length; i++) {
      gaps.push(startsInWindow[i] - startsInWindow[i - 1]);
    }
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const medianMs = gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
    medianGapHours = medianMs / (60 * 60 * 1000);
  }

  return { incidentFreeDays, totalDays: windowDays, medianGapHours, longestStreakDays };
}

// Bucket key for typical-duration cohorts: same kind, same line/route, same
// signal "type" (single signal name, or 'roundup' for multi-signal records).
// Returns null when the incident lacks a signal — pure CTA alerts have no
// type to bucket on, so they get no median hint.
export function typicalDurationKey(incident) {
  if (!incident) return null;
  const kind = incident.kind;
  // Standalone observation has `line`; merged record carries the observation's
  // line as `obs_line` (the alert's `routes` may include multiple lines).
  const lineOrRoute = incident.obs_line ?? incident.line ?? null;
  if (!kind || !lineOrRoute) return null;

  const detection = incident.obs_detection_source ?? incident.detection_source;
  if (!detection) return null;
  const signal = detection === 'roundup' ? 'roundup' : detection;
  return `${kind}::${lineOrRoute}::${signal}`;
}

// Median resolved-incident duration per (kind, line, signal) cohort over a
// rolling window. Powers the "typically clears in ~Xm" hint on active alert
// cards. Only resolved incidents count (active ones have no real duration);
// pure CTA alerts are excluded (no signal type — see typicalDurationKey).
//
// Returns a Map of bucket-key → { medianMs, count }. Callers gate display on
// count >= some threshold (5 by convention) so a sparse cohort can't show a
// volatile median.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowDays]
 * @returns {Map<string, { medianMs: number, count: number }>}
 */
export function computeTypicalDurations(
  alerts,
  observations,
  { now = Date.now(), windowDays = 90 } = {},
) {
  const cutoff = now - windowDays * DAY_MS;
  const buckets = new Map();

  function add(incident, startTs, resolvedTs) {
    if (resolvedTs == null) return;
    if (startTs < cutoff) return;
    const duration = resolvedTs - startTs;
    if (duration <= 0) return;
    const key = typicalDurationKey(incident);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(duration);
  }

  const { merged, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  for (const m of merged) add(m, m.first_seen_ts, m.resolved_ts);
  for (const o of standaloneObs) add(o, o.ts, o.resolved_ts);

  const out = new Map();
  for (const [key, durations] of buckets) {
    durations.sort((a, b) => a - b);
    const mid = Math.floor(durations.length / 2);
    const medianMs =
      durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid];
    out.set(key, { medianMs, count: durations.length });
  }
  return out;
}

// One-line narrative summary of today's activity for the homepage. Uses
// merged incidents so an alert+observation pair counts once. Returns null
// when there's no data to summarize (e.g. before data_start_ts).
//
// Outputs one of three shapes:
//   - quiet day:   "Quiet today — 0 incidents so far · 14 hours since the last."
//   - busy day:    "Today: 5 incidents across 3 lines · 1 still ongoing."
//   - simple busy: "Today: 1 incident on the Red Line."
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {number} [now]
 * @returns {string | null}
 */
export function buildTodaySummary(alerts, observations, now = Date.now()) {
  const todayUtc = chicagoDayUTC(now);

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  const todays = [];
  const allTs = [];
  function consider(ts, lines, active) {
    if (ts == null) return;
    allTs.push(ts);
    if (chicagoDayUTC(ts) !== todayUtc) return;
    todays.push({ lines: lines || [], active });
  }
  for (const m of merged) consider(m.first_seen_ts, m.routes, m.active);
  for (const a of standaloneAlerts) consider(a.first_seen_ts, a.routes, a.active);
  for (const o of standaloneObs) consider(o.ts, [o.line], o.active);

  if (allTs.length === 0) return null;

  if (todays.length === 0) {
    const lastTs = Math.max(...allTs);
    const elapsedMs = now - lastTs;
    if (elapsedMs < 0) return 'Quiet today — 0 incidents so far.';
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    if (hours < 24) {
      return `Quiet today — 0 incidents so far · ${hours} hour${hours === 1 ? '' : 's'} since the last.`;
    }
    const days = Math.floor(hours / 24);
    return `Quiet today — 0 incidents so far · ${days} day${days === 1 ? '' : 's'} since the last incident.`;
  }

  const activeCount = todays.filter((i) => i.active).length;
  const lineSet = new Set();
  for (const inc of todays) {
    for (const l of inc.lines) lineSet.add(l);
  }

  const incidentWord = todays.length === 1 ? 'incident' : 'incidents';
  let head = `Today: ${todays.length} ${incidentWord}`;
  if (lineSet.size > 1) {
    head += ` across ${lineSet.size} lines/routes`;
  } else if (lineSet.size === 1) {
    const only = [...lineSet][0];
    const trainLabel = TRAIN_LINE_ORDER.includes(only)
      ? `the ${only.charAt(0).toUpperCase()}${only.slice(1)} Line`
      : null;
    head += trainLabel ? ` on ${trainLabel}` : ` on #${only}`;
  }
  if (activeCount > 0) {
    head += ` · ${activeCount} still ongoing`;
  }
  return `${head}.`;
}

// Leaderboard-style stats for the /stats page. Computed against the full
// dataset (no filtering) so each "worst" answer reflects the project's
// recorded history end-to-end. Returns null fields when there's nothing
// in the cohort yet rather than fake-zero rows.
//
//   worstDay        — Chicago calendar day with the most distinct incidents.
//   worstHour       — (weekday, hour) cell of the hour-of-week heatmap with
//                     the highest start count.
//   worstStation    — station with the most incident touches in the rolling
//                     window (uses buildStationIndex's own gating).
//   longestIncident — longest resolved incident in ms with its key fields.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowDays] Used by station + day cohorts.
 * @returns {{
 *   worstDay: { dayUtc: number, count: number } | null,
 *   worstHour: { weekday: number, hour: number, count: number } | null,
 *   worstStation: { slug: string, name: string, count: number, lines: string[] } | null,
 *   longestIncident: {
 *     id: string,
 *     kind: string,
 *     routes: string[],
 *     headline: string | null,
 *     fromStation: string | null,
 *     toStation: string | null,
 *     startTs: number,
 *     endTs: number,
 *     durationMs: number,
 *     postUrl: string | null,
 *   } | null,
 * }}
 */
export function computeStatsLeaderboards(
  alerts,
  observations,
  { now = Date.now(), windowDays = 90 } = {},
) {
  const cutoff = now - windowDays * DAY_MS;

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

  // worstDay — bucket each incident by its Chicago start day.
  const dayCounts = new Map();
  function bumpDay(ts) {
    if (ts == null) return;
    const day = chicagoDayUTC(ts);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  for (const m of merged) bumpDay(m.first_seen_ts);
  for (const a of standaloneAlerts) bumpDay(a.first_seen_ts);
  for (const o of standaloneObs) bumpDay(o.ts);
  let worstDay = null;
  for (const [dayUtc, count] of dayCounts) {
    if (!worstDay || count > worstDay.count) worstDay = { dayUtc, count };
  }

  // worstHour — same dataset reused via buildHourOfWeek so the cell
  // semantics match the homepage heatmap exactly.
  const { grid, maxCount: hourMax, total: hourTotal } = buildHourOfWeek(alerts, observations);
  let worstHour = null;
  if (hourTotal > 0 && hourMax > 0) {
    for (let w = 0; w < 7; w++) {
      for (let h = 0; h < 24; h++) {
        if (grid[w][h] === hourMax) {
          worstHour = { weekday: w, hour: h, count: hourMax };
          break;
        }
      }
      if (worstHour) break;
    }
  }

  // worstStation — reuse buildStationIndex (windowDays-bounded by design).
  const stationIndex = buildStationIndex(alerts, observations, { now, windowDays });
  let worstStation = null;
  for (const rec of stationIndex.values()) {
    if (!worstStation || rec.count > worstStation.count) {
      worstStation = {
        slug: rec.slug,
        name: rec.name,
        count: rec.count,
        lines: rec.lines,
      };
    }
  }

  // longestIncident — only resolved incidents with a positive duration count.
  // Walk merged + standalones the same way the rest of the app does so a
  // merged alert+obs pair contributes once with its alert-side metadata.
  let longestIncident = null;
  function offer(incident, startTs, endTs) {
    if (endTs == null || startTs == null) return;
    const durationMs = endTs - startTs;
    if (durationMs <= 0) return;
    if (longestIncident && durationMs <= longestIncident.durationMs) return;
    const id = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url) ?? null;
    if (!id) return;
    longestIncident = {
      id,
      kind: incident.kind,
      routes: incident.routes ?? (incident.line ? [incident.line] : []),
      headline: incident.headline ?? null,
      fromStation: incident.from_station ?? incident.affected_from_station ?? null,
      toStation: incident.to_station ?? incident.affected_to_station ?? null,
      startTs,
      endTs,
      durationMs,
      postUrl: incident.post_url ?? incident.obs_post_url ?? null,
    };
  }
  for (const m of merged) offer(m, m.first_seen_ts, m.resolved_ts);
  for (const a of standaloneAlerts) offer(a, a.first_seen_ts, a.resolved_ts);
  for (const o of standaloneObs) offer(o, o.ts, o.resolved_ts);

  // Note: `cutoff` isn't applied to worstDay / longestIncident so the page
  // can show a "longest incident on record" rather than artificially clipping.
  // The window only matters for stations and hour-of-week, where the cohort
  // sizes change as data ages out.
  void cutoff;

  return { worstDay, worstHour, worstStation, longestIncident };
}

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
