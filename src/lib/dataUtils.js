import { TRAIN_LINE_ORDER } from './ctaLines.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

  function addSpan(lineId, startTs, endTs) {
    if (!TRAIN_LINE_ORDER.includes(lineId)) return;
    if (!result[lineId]) result[lineId] = {};

    const end = endTs || now;
    // dayIdx: how many full days ago did this event start/end?
    const startDayIdx = Math.floor((now - startTs) / DAY_MS); // larger = further in past
    const endDayIdx = Math.floor((now - end) / DAY_MS);       // smaller = more recent

    const lo = Math.max(0, endDayIdx);
    const hi = Math.min(numDays - 1, startDayIdx);
    for (let d = lo; d <= hi; d++) {
      result[lineId][d] = (result[lineId][d] || 0) + 1;
    }
  }

  for (const a of alerts) {
    if (a.kind !== 'train') continue;
    for (const route of a.routes) {
      addSpan(route, a.first_seen_ts, a.resolved_ts);
    }
  }

  for (const o of observations) {
    if (o.kind !== 'train') continue;
    addSpan(o.line, o.ts, o.resolved_ts);
  }

  return result;
}

// Filter alerts and observations by selected train lines and a start timestamp.
// Active incidents bypass the timestamp filter so they always appear.
export function filterIncidents(alerts, observations, { lines, startTs } = {}) {
  const hasLineFilter = lines && lines.length > 0;

  const filteredAlerts = alerts.filter((a) => {
    if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
    if (startTs && a.first_seen_ts < startTs && !a.active) return false;
    return true;
  });

  const filteredObs = observations.filter((o) => {
    if (hasLineFilter && !lines.includes(o.line)) return false;
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  return { alerts: filteredAlerts, observations: filteredObs };
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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
