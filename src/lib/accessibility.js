import { normalizeTrainLine } from './ctaLines.js';
import { dataUrl } from './dataSource.js';
import { normalizeMetraLine } from './metraLines.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export async function fetchAccessibilityData() {
  const res = await fetch(dataUrl('accessibility.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function stationHref(outageOrRow) {
  const agency = outageOrRow?.agency;
  const slug = outageOrRow?.station?.slug ?? outageOrRow?.slug;
  if (!slug) return null;
  return agency === 'metra' ? `/metra/station/${slug}` : `/station/${slug}`;
}

export function outageDuration(outage, now = Date.now()) {
  const start = outage?.lifecycle?.first_seen_ts;
  if (start == null) return 0;
  const end = outage.lifecycle.restored_ts ?? (outage.lifecycle.active ? now : null);
  return end == null ? 0 : Math.max(0, end - start);
}

export function stationLabel(outage) {
  return outage?.station?.name || 'Unmatched station';
}

export function agencyLabel(agency) {
  return agency === 'metra' ? 'Metra' : 'CTA';
}

export function normalizeOutageLine(agency, line) {
  if (agency === 'metra') return normalizeMetraLine(line);
  if (agency === 'cta') return normalizeTrainLine(line);
  return line;
}

export function outageHasLine(outage, line) {
  if (!line) return true;
  const want = normalizeOutageLine(outage?.agency, line);
  return (outage?.station?.lines || []).some(
    (raw) => normalizeOutageLine(outage?.agency, raw) === want,
  );
}

export function currentlyOut(outages = [], { now = Date.now(), agency = null, line = null } = {}) {
  return outages
    .filter((o) => o.lifecycle?.active)
    .filter((o) => !agency || o.agency === agency)
    .filter((o) => outageHasLine(o, line))
    .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
    .sort(
      (a, b) =>
        b.durationMs - a.durationMs ||
        a.agency.localeCompare(b.agency) ||
        stationLabel(a).localeCompare(stationLabel(b)),
    );
}

export function outagesForStation(
  outages = [],
  { agency, slug, now = Date.now(), limit = 8 } = {},
) {
  if (!agency || !slug) return [];
  return outages
    .filter((o) => o.agency === agency && o.station?.slug === slug)
    .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
    .sort((a, b) => {
      if (a.lifecycle?.active !== b.lifecycle?.active) return a.lifecycle?.active ? -1 : 1;
      return (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0);
    })
    .slice(0, limit);
}

export function stationReliability(
  outages = [],
  { now = Date.now(), windowDays = 90, agency = null, line = null } = {},
) {
  const cutoff = now - windowDays * DAY_MS;
  const byStation = new Map();
  for (const outage of outages) {
    if (agency && outage.agency !== agency) continue;
    if (!outageHasLine(outage, line)) continue;
    const start = outage.lifecycle?.first_seen_ts;
    if (start == null) continue;
    const restored = outage.lifecycle?.restored_ts ?? (outage.lifecycle?.active ? now : null);
    if (restored != null && restored < cutoff) continue;
    const key = `${outage.agency}:${outage.station?.slug || stationLabel(outage)}`;
    if (!byStation.has(key)) {
      byStation.set(key, {
        agency: outage.agency,
        slug: outage.station?.slug ?? null,
        name: stationLabel(outage),
        lines: outage.station?.lines || [],
        outageCount: 0,
        totalDownMs: 0,
        currentlyOut: 0,
        weeklyDownMs: Array.from({ length: Math.ceil(windowDays / 7) }, () => 0),
      });
    }
    const rec = byStation.get(key);
    const boundedStart = Math.max(start, cutoff);
    const boundedEnd = Math.max(boundedStart, restored ?? now);
    rec.outageCount += 1;
    rec.totalDownMs += Math.max(0, boundedEnd - boundedStart);
    if (outage.lifecycle?.active) rec.currentlyOut += 1;
    addWeeklyDurations(rec.weeklyDownMs, boundedStart, boundedEnd, cutoff);
  }
  return [...byStation.values()].sort(
    (a, b) =>
      b.currentlyOut - a.currentlyOut ||
      b.totalDownMs - a.totalDownMs ||
      b.outageCount - a.outageCount ||
      a.agency.localeCompare(b.agency) ||
      a.name.localeCompare(b.name),
  );
}

function addWeeklyDurations(buckets, start, end, cutoff) {
  let cursor = start;
  while (cursor < end) {
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor((cursor - cutoff) / WEEK_MS)));
    const next = Math.min(end, cutoff + (idx + 1) * WEEK_MS);
    buckets[idx] += Math.max(0, next - cursor);
    cursor = next;
  }
}
