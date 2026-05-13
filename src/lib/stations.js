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

const DAY_MS = 24 * 60 * 60 * 1000;

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
        lines: new Set(),
        alerts: [],
        observations: [],
      });
    }
    const rec = index.get(slug);
    if (line) rec.lines.add(line);
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
    for (const name of [a.affected_from_station, a.affected_to_station]) {
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
      lines: [...rec.lines].sort(),
      alerts: rec.alerts,
      observations: rec.observations,
      count: rec.alerts.length + rec.observations.length,
    });
  }
  return out;
}
