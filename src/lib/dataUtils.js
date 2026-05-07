import { TRAIN_LINE_ORDER } from './ctaLines.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Returns a stable epoch (UTC midnight) representing the Chicago calendar day
// that contains `ts`. Used to bucket incidents by calendar day rather than by
// sliding 24-hour windows from `now`, which would otherwise smear an evening
// incident across two columns depending on the current wall time.
const chicagoDayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function chicagoDayUTC(ts) {
  let y, m, d;
  for (const p of chicagoDayParts.formatToParts(new Date(ts))) {
    if (p.type === 'year') y = +p.value;
    else if (p.type === 'month') m = +p.value;
    else if (p.type === 'day') d = +p.value;
  }
  return Date.UTC(y, m - 1, d);
}

// Convert a hex color string to an rgba() string.
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Build a map of lineId -> { dayIdx: incidentCount } for the timeline grid.
// dayIdx 0 = today, 1 = yesterday, ..., numDays-1 = oldest day shown.
// Only includes train lines (bus incidents appear in the list but not the grid).
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

// Filter alerts and observations by selected train lines, bus toggle, and a
// start timestamp. Active incidents bypass the timestamp filter so they always
// appear. Bus observations are controlled independently of the train line
// filter — selecting Red Line doesn't hide bus observations when showBus=true.
export function filterIncidents(
  alerts,
  observations,
  { lines, startTs, showBus = true, busRoutes = null } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;

  const filteredAlerts = alerts.filter((a) => {
    if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
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
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  return { alerts: filteredAlerts, observations: filteredObs };
}

// Merge bot observations into their matching official CTA alerts when they
// share the same line and overlapping time window. Returns:
//   merged        — combined alert+observation records
//   standaloneAlerts — alerts with no matching observation
//   standaloneObs    — observations with no matching alert
export function mergeMatchingIncidents(alerts, observations) {
  const BUFFER_MS = 2 * 60 * 60 * 1000; // 2-hour window on each side

  const usedObsIds = new Set();
  const usedAlertIds = new Set();
  const merged = [];

  for (const alert of alerts) {
    if (alert.kind !== 'train') continue;
    const alertEnd = (alert.resolved_ts || alert.last_seen_ts || Infinity) + BUFFER_MS;

    for (const obs of observations) {
      if (usedObsIds.has(obs.id)) continue;
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

// Headline stats for the at-a-glance summary line. Always computed against
// the full dataset (not the filtered view) so the answer to "how's the CTA
// doing right now" doesn't change based on whatever the user has narrowed to.
// Uses merged incidents so a CTA alert and a matching bot observation count
// once, not twice. Most-affected uses a 30-day window for stability — a
// 7-day window flips around too much when one bad day dominates.
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

export function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `~${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  });
}
