// Metra station roster + slug helpers — the Metra parallel of the CTA station
// system in stations.js. Built from metraStations.json (generated from GTFS
// stops.txt in cta-insights). Metra stations live under `/metra/station/:slug`
// to keep them isolated from the CTA `/station/:slug` namespace.

import { normalizeMetraLine } from './metraLines.js';
import metraStationsData from './metraStations.json';
import { slugifyStation } from './stations.js';

// slug → { slug, name, lines: [metra web keys] }, and slug → Set(line keys).
const METRA_BY_SLUG = new Map();
const SERVED_LINES = new Map();

for (const [route, stations] of Object.entries(metraStationsData)) {
  const lineKey = normalizeMetraLine(route);
  for (const st of stations || []) {
    const slug = slugifyStation(st.name);
    if (!slug) continue;
    if (!SERVED_LINES.has(slug)) SERVED_LINES.set(slug, new Set());
    SERVED_LINES.get(slug).add(lineKey);
    if (!METRA_BY_SLUG.has(slug)) {
      METRA_BY_SLUG.set(slug, { slug, name: st.name, lines: [] });
    }
  }
}
for (const [slug, rec] of METRA_BY_SLUG) {
  rec.lines = [...SERVED_LINES.get(slug)].sort();
}

/** True if `slug` matches a Metra roster station. */
export function isKnownMetraStationSlug(slug) {
  return slug != null && METRA_BY_SLUG.has(slug);
}

/** Roster record `{ slug, name, lines }` for a Metra station slug, or null. */
export function metraStationBySlug(slug) {
  return METRA_BY_SLUG.get(slug) ?? null;
}

/** Metra line web keys serving a station name (empty when unrecognized). */
export function metraLinesServingStation(name) {
  const slug = slugifyStation(name);
  return slug ? [...(SERVED_LINES.get(slug) || [])] : [];
}

/** Roster stations served by a Metra line key, in roster order. */
export function metraStationsServingLine(lineKey) {
  return [...METRA_BY_SLUG.values()].filter((s) => s.lines.includes(lineKey));
}

/** Every Metra roster station `{ slug, name, lines }`, name-sorted. */
export function metraStationRoster() {
  return [...METRA_BY_SLUG.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * slug → { slug, name, lines, count } for Metra stations referenced by an
 * incident in the rolling window. The Metra analog of `buildStationIndex`
 * (stations.js): cancellation/delay observations carry from/to stations, and
 * republished Metra alerts carry affected/mentioned stations.
 * @param {Array} alerts
 * @param {Array} observations
 * @param {{ now?: number, windowDays?: number }} [opts]
 */
export function buildMetraStationIndex(
  alerts,
  observations,
  { now = Date.now(), windowDays = 90 } = {},
) {
  const cutoff = now - windowDays * DAY_MS;
  const index = new Map();
  function bucket(name) {
    const slug = slugifyStation(name);
    if (!slug) return null;
    if (!index.has(slug)) {
      const roster = METRA_BY_SLUG.get(slug);
      index.set(slug, {
        slug,
        name: roster?.name ?? name,
        // Seed every line that physically serves the station, like the CTA index.
        lines: new Set(SERVED_LINES.get(slug) || []),
        alerts: [],
        observations: [],
      });
    }
    return index.get(slug);
  }

  for (const o of observations || []) {
    if (o.kind !== 'metra' || o.ts < cutoff) continue;
    for (const name of [o.from_station, o.to_station]) {
      const rec = bucket(name);
      if (rec && !rec.observations.includes(o)) rec.observations.push(o);
    }
  }
  for (const a of alerts || []) {
    if (a.kind !== 'metra' || a.first_seen_ts < cutoff) continue;
    const names = [a.affected_from_station, a.affected_to_station, ...(a.mentioned_stations || [])];
    for (const name of names) {
      const rec = bucket(name);
      if (rec && !rec.alerts.includes(a)) rec.alerts.push(a);
    }
  }

  const out = new Map();
  for (const [slug, rec] of index) {
    out.set(slug, {
      slug: rec.slug,
      name: rec.name,
      lines: [...rec.lines].sort(),
      count: rec.alerts.length + rec.observations.length,
    });
  }
  return out;
}
