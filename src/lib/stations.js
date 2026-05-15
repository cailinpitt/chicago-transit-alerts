// Station discovery + slug helpers. Stations only show up on a small slice
// of the data — train pulse-cold/pulse-held observations carry segment
// endpoints (`from_station`, `to_station`), and a handful of bus alerts
// reference stations for stop relocations. Roundups, train alerts, and the
// rest don't carry station info, so this index is naturally sparse.
//
// Upstream (cta-insights) already disambiguates stations that share a name
// across lines via parenthetical qualifiers — `Central (Green)` vs
// `Central (Purple)`, `Western (Brown)` vs `Western (Blue/Forest Park)`.
// We trust the literal string as station identity. If two physically
// different stations ever share the exact same name in the data, that's a
// data-quality issue upstream, not something to paper over here.

import { normalizeTrainLine, TRAIN_LINE_ORDER } from './ctaLines.js';
// Node 22+ ESM requires the explicit import attribute when loading JSON;
// without it the postbuild prerender scripts (which import this file
// transitively via scripts/prerender-pages.js and scripts/generate-sitemap.js)
// crash with ERR_IMPORT_ATTRIBUTE_MISSING. Vite 6 understands the same syntax.
import trainStations from './trainStations.json' with { type: 'json' };

const DAY_MS = 24 * 60 * 60 * 1000;

// slug → array of normalized line keys that physically serve this station,
// derived from the bundled trainStations.json roster. Without this, the
// station's `lines` set would be inferred purely from incidents in the
// rolling window — so a multi-line station like Ashland (Green/Pink)
// renders only the Pink pill when only Pink had a recent incident, even
// though the station physically serves Green too.
const SERVED_LINES_BY_SLUG = (() => {
  const map = new Map();
  for (const s of trainStations) {
    const slug = slugifyStation(s.name);
    if (!slug) continue;
    map.set(
      slug,
      (s.lines || []).map(normalizeTrainLine).filter((l) => TRAIN_LINE_ORDER.includes(l)),
    );
  }
  return map;
})();

function compareByCtaOrder(a, b) {
  const ia = TRAIN_LINE_ORDER.indexOf(a);
  const ib = TRAIN_LINE_ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
}

// Drop the parenthetical line qualifier upstream uses to disambiguate
// same-named stations across lines: `Central (Purple)` → `Central`. Used
// everywhere we display a station name *next to* a line pill or under a
// line-page heading — the suffix is redundant noise in those contexts.
// The StationPage heading still uses the raw name (with the suffix) since
// that page can be linked to standalone and needs to be unambiguous.
/**
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function displayStationName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

// Slugify a station name for use in URLs. Lowercase, collapse runs of
// non-alphanumeric chars to '-', trim. `Central (Green)` → `central-green`,
// `Clark/Division` → `clark-division`, `O'Hare` → `o-hare`.
export function slugifyStation(name) {
  if (!name) return null;
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

// Build a map of slug → station record covering the rolling window. Each
// record collects the raw alerts and observations that touched the station
// at either endpoint. Train-only by design: bus has 0% station coverage on
// observations and a handful of stop-relocation alerts isn't enough to
// justify the added scope. Downstream consumers re-merge alerts/obs via
// `mergeMatchingIncidents`, the same way LinePage and IncidentList do.
/**
 * @param {import('./incidents.js').Alert[]} alerts
 * @param {import('./incidents.js').Observation[]} observations
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.windowDays]
 * @returns {Map<string, {
 *   slug: string,
 *   name: string,
 *   lines: string[],
 *   alerts: import('./incidents.js').Alert[],
 *   observations: import('./incidents.js').Observation[],
 *   count: number,
 * }>}
 */
export function buildStationIndex(
  alerts,
  observations,
  { now = Date.now(), windowDays = 90 } = {},
) {
  const cutoff = now - windowDays * DAY_MS;
  const index = new Map();

  function bucket(name, line) {
    const slug = slugifyStation(name);
    if (!slug) return null;
    if (!index.has(slug)) {
      index.set(slug, {
        slug,
        name,
        // Seed from the master roster so every line that physically serves
        // this station renders a pill, not just the ones that happened to
        // have an incident in the window.
        lines: new Set(SERVED_LINES_BY_SLUG.get(slug) || []),
        alerts: [],
        observations: [],
      });
    }
    const rec = index.get(slug);
    // Normalize so a raw short-code (`'p'`) coming from a caller that
    // bypassed normalizeAlertsPayload doesn't co-exist with the full-name
    // (`'purple'`) seeded from the master roster.
    if (line) rec.lines.add(normalizeTrainLine(line));
    return rec;
  }

  for (const o of observations || []) {
    if (o.kind !== 'train') continue;
    if (o.ts < cutoff) continue;
    for (const name of [o.from_station, o.to_station]) {
      const rec = bucket(name, o.line);
      if (rec && !rec.observations.includes(o)) rec.observations.push(o);
    }
  }

  for (const a of alerts || []) {
    if (a.kind !== 'train') continue;
    if (a.first_seen_ts < cutoff) continue;
    // affected_from/to_station carry the segment endpoints upstream extracts
    // for "between X and Y" alerts. mentioned_stations carries everything
    // else — single-station impact mentions ("delays at Monroe") plus the
    // segment endpoints again. The Set on the bucket dedupes overlap.
    const names = [
      a.affected_from_station,
      a.affected_to_station,
      ...(a.mentioned_stations || []),
    ];
    for (const name of names) {
      for (const line of a.routes || []) {
        const rec = bucket(name, line);
        if (rec && !rec.alerts.includes(a)) rec.alerts.push(a);
      }
    }
  }

  // Finalize: convert `lines` to a sorted array and compute the headline
  // count. The count is what IncidentList uses to gate "should this name
  // become a clickable link"; it's the unique-incident total at the
  // station, pre-merge (close enough for that gating decision).
  const out = new Map();
  for (const [slug, rec] of index) {
    out.set(slug, {
      slug: rec.slug,
      name: rec.name,
      lines: [...rec.lines].sort(compareByCtaOrder),
      alerts: rec.alerts,
      observations: rec.observations,
      count: rec.alerts.length + rec.observations.length,
    });
  }
  return out;
}
