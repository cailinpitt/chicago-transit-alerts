// Formatting helpers — date/time/duration strings and color conversions.
// Time formatting is pinned to America/Chicago so the displayed values match
// what a Chicago rider sees, regardless of where the browser is.

const chicagoDayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Returns a stable epoch (UTC midnight) representing the Chicago calendar day
// that contains `ts`. Used to bucket incidents by calendar day rather than by
// sliding 24-hour windows from `now`, which would otherwise smear an evening
// incident across two columns depending on the current wall time.
export function chicagoDayUTC(ts) {
  let y, m, d;
  for (const p of chicagoDayParts.formatToParts(new Date(ts))) {
    if (p.type === 'year') y = +p.value;
    else if (p.type === 'month') m = +p.value;
    else if (p.type === 'day') d = +p.value;
  }
  return Date.UTC(y, m - 1, d);
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `~${totalMin}m`;
  const totalH = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (totalH < 24) return m > 0 ? `~${totalH}h ${m}m` : `~${totalH}h`;
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  const parts = [`${d}d`];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return `~${parts.join(' ')}`;
}

// Compact "X min" / "X hr" form for stabilization-time deltas. Differs from
// formatDuration: no `~`, rounds to whole minutes under an hour, and drops
// stray seconds entirely. Returns null for non-positive deltas — a CTA alert
// that cleared *after* the bot saw service return shouldn't render a
// negative "stabilized -3 min after".
export function formatStabilizationDelta(ms) {
  if (ms == null || ms <= 0) return null;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Format a duration given in *hours* for the per-line "median gap between
// incidents" stat: minutes for sub-hour gaps, whole hours for sub-day, and
// "Xd Yh" beyond. Differs from formatDuration: input is hours, no `~` prefix,
// and we round to whole hours past 1h since median-gap stats don't need
// minute precision.
export function formatGap(hours) {
  if (hours == null) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

// Format an integer count of minutes as a compact "Xh Ym" / "Xh" / "Ym"
// string. Used for disruption-hours summaries where totals can run from a few
// minutes (light week on one line) to several hundred hours (busy month
// system-wide). No `~` prefix — disruption totals are sums, not estimates.
export function formatMinutesAsHours(minutes) {
  if (minutes == null || minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h - d * 24;
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

// Format a value produced by `chicagoDayUTC` (a UTC midnight that *encodes*
// the Chicago calendar Y/M/D in its components, not a true Chicago wall-clock
// instant). Formatting one of those with `formatDate` re-applies the Chicago
// offset and shifts the result back a calendar day; format as UTC instead so
// the date components round-trip.
export function formatChicagoDay(dayUtc) {
  return new Date(dayUtc).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  });
}
