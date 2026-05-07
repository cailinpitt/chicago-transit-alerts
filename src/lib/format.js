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
