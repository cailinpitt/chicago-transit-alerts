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
