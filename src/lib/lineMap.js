// Geographic line-map helpers for the LinePage train heatmap. Loads station
// and track data (CTA-derived, lat/lon) and projects it into SVG coordinates
// so the rendered map has real Chicago shape rather than a stylized strip.
//
// Bus is excluded by design — the data files cover the L only, and a bus
// route's stop count makes a per-stop heatmap noisy at this scale.

import { TRAIN_LINE_ORDER } from './ctaLines.js';
import { slugifyStation } from './stations.js';
import lines from './trainLines.json';
import stations from './trainStations.json';

// trainStations.json + trainLines.json use CTA short codes (brn, g, org, p,
// y). Map the rest of the app's full-name keys back to short codes for
// data lookup. Identity for the lines whose codes already match their name.
const FULL_TO_SHORT = {
  red: 'red',
  blue: 'blue',
  brown: 'brn',
  green: 'g',
  orange: 'org',
  pink: 'pink',
  purple: 'p',
  yellow: 'y',
};

export function shortCodeFor(lineKey) {
  return FULL_TO_SHORT[lineKey] ?? lineKey;
}

// Build the projected geometry for a single train line. Returns null when
// the line key isn't recognized or the data is missing — the caller should
// render nothing in that case rather than a half-broken SVG.
//
// Projection is straight linear interpolation from a lat/lon bounding box
// into a configurable SVG viewBox. Chicago's footprint is small enough
// (~30 km across) that flat projection reads correctly at this scale.
//
//   stationIndex — Map<slug, { count, ... }> from buildStationIndex.
//                  Optional; missing entries → count 0.
/**
 * @param {string} lineKey full-name line key ('red', 'brown', etc.)
 * @param {Map<string, any> | null} [stationIndex]
 * @param {object} [options]
 * @param {number} [options.width]   SVG inner width (excludes margin).
 * @param {number} [options.height]  SVG inner height.
 * @param {number} [options.margin]  Margin around the projected bbox.
 * @returns {{
 *   width: number,
 *   height: number,
 *   tracks: Array<Array<{ x: number, y: number }>>,
 *   stations: Array<{ name: string, slug: string, count: number, x: number, y: number }>,
 *   maxCount: number,
 * } | null}
 */
export function buildLineMap(
  lineKey,
  stationIndex = null,
  { width = 720, height = 360, margin = 16 } = {},
) {
  if (!TRAIN_LINE_ORDER.includes(lineKey)) return null;
  const short = shortCodeFor(lineKey);
  const segments = lines[short];
  const lineStations = stations.filter((s) => Array.isArray(s.lines) && s.lines.includes(short));
  if (!segments || lineStations.length === 0) return null;

  // Build a single bbox from all the points across both tracks and stations
  // so the projection fits everything. Lat/lon order: y = lat (north +),
  // x = lon (east +). SVG y is inverted later.
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    for (const [lat, lon] of seg) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  for (const s of lineStations) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  const latRange = Math.max(maxLat - minLat, 1e-6);
  const lonRange = Math.max(maxLon - minLon, 1e-6);

  // Preserve aspect ratio by scaling on the tighter axis. Otherwise the
  // Loop's L-shapes get distorted.
  const innerW = width - 2 * margin;
  const innerH = height - 2 * margin;
  const scale = Math.min(innerW / lonRange, innerH / latRange);
  const projW = lonRange * scale;
  const projH = latRange * scale;
  const offX = margin + (innerW - projW) / 2;
  const offY = margin + (innerH - projH) / 2;

  const project = (lat, lon) => ({
    x: offX + (lon - minLon) * scale,
    // SVG y grows downward, so flip lat (higher lat = smaller y).
    y: offY + (maxLat - lat) * scale,
  });

  const tracks = segments.map((seg) => seg.map(([lat, lon]) => project(lat, lon)));

  const projectedStations = lineStations.map((s) => {
    const slug = slugifyStation(s.name);
    const count = slug && stationIndex ? (stationIndex.get(slug)?.count ?? 0) : 0;
    const { x, y } = project(s.lat, s.lon);
    return { name: s.name, slug, count, x, y };
  });
  let maxCount = 0;
  for (const s of projectedStations) {
    if (s.count > maxCount) maxCount = s.count;
  }

  return {
    width,
    height,
    tracks,
    stations: projectedStations,
    maxCount,
  };
}
