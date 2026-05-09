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

// Bounding box around downtown Chicago — covers the elevated Loop, the
// Red Line subway through the Loop, and Blue's Dearborn subway. Lines with
// ≥4 stations inside this box get a zoom inset on their map page so the
// dense cluster doesn't render as overlapping dots.
const DOWNTOWN_BBOX = {
  latLo: 41.872,
  latHi: 41.89,
  lonLo: -87.645,
  lonHi: -87.62,
};
const DOWNTOWN_INSET_THRESHOLD = 4;

export function shortCodeFor(lineKey) {
  return FULL_TO_SHORT[lineKey] ?? lineKey;
}

function inBox(lat, lon, bbox) {
  return lat >= bbox.latLo && lat <= bbox.latHi && lon >= bbox.lonLo && lon <= bbox.lonHi;
}

// Project a set of stations + track segments into a fixed SVG box. Used
// twice: once for the full-line map, once for the downtown inset (after
// pre-filtering to bbox).
function projectInto(rawStations, segments, { width, height, margin }) {
  if (rawStations.length === 0) return null;

  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  function expand(lat, lon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  for (const s of rawStations) expand(s.lat, s.lon);
  for (const seg of segments) {
    for (const [lat, lon] of seg) expand(lat, lon);
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
    y: offY + (maxLat - lat) * scale,
  });

  const projectedStations = rawStations.map((s) => ({
    name: s.name,
    slug: s.slug,
    count: s.count,
    ...project(s.lat, s.lon),
  }));
  const projectedTracks = segments.map((seg) => seg.map(([lat, lon]) => project(lat, lon)));

  // Bbox in projected (SVG) space — useful for the main map to draw a
  // rectangle indicating "this is the area zoomed in the inset."
  const bboxRect = {
    x: offX,
    y: offY,
    width: projW,
    height: projH,
  };

  return {
    width,
    height,
    stations: projectedStations,
    tracks: projectedTracks,
    bboxRect,
    // Expose the projection so callers can map additional points (e.g.
    // the downtown bbox corners) into the same SVG coordinate space.
    project,
  };
}

// Build the projected geometry for a single train line. Returns null when
// the line key isn't recognized or the data is missing — the caller should
// render nothing in that case rather than a half-broken SVG.
//
//   stationIndex — Map<slug, { count, ... }> from buildStationIndex.
//                  Optional; missing entries → count 0.
/**
 * @param {string} lineKey full-name line key ('red', 'brown', etc.)
 * @param {Map<string, any> | null} [stationIndex]
 * @param {object} [options]
 * @param {number} [options.width]   Main SVG width.
 * @param {number} [options.height]  Main SVG height.
 * @param {number} [options.margin]  Margin around the projected bbox.
 * @returns {{
 *   width: number,
 *   height: number,
 *   tracks: Array<Array<{ x: number, y: number }>>,
 *   stations: Array<{ name: string, slug: string, count: number, x: number, y: number }>,
 *   maxCount: number,
 *   downtown: null | {
 *     stations: Array<{ name: string, slug: string, count: number, x: number, y: number }>,
 *     tracks: Array<Array<{ x: number, y: number }>>,
 *     width: number,
 *     height: number,
 *     mainBoxRect: { x: number, y: number, width: number, height: number },
 *   },
 * } | null}
 */
export function buildLineMap(
  lineKey,
  stationIndex = null,
  { width = 720, height = 360, margin = 18 } = {},
) {
  if (!TRAIN_LINE_ORDER.includes(lineKey)) return null;
  const short = shortCodeFor(lineKey);
  const segments = lines[short];
  const lineStations = stations.filter((s) => Array.isArray(s.lines) && s.lines.includes(short));
  if (!segments || lineStations.length === 0) return null;

  // Annotate stations with their incident counts up front so both projections
  // share the same enriched records.
  const enriched = lineStations.map((s) => {
    const slug = slugifyStation(s.name);
    const count = slug && stationIndex ? (stationIndex.get(slug)?.count ?? 0) : 0;
    return { name: s.name, slug, lat: s.lat, lon: s.lon, count };
  });

  const main = projectInto(enriched, segments, { width, height, margin });
  if (!main) return null;

  let maxCount = 0;
  for (const s of main.stations) {
    if (s.count > maxCount) maxCount = s.count;
  }

  // Downtown inset — only when enough stations cluster there. Scope the
  // track segments to points inside the bbox, with one bridging point on
  // either side to avoid clipped lines that look chopped.
  let downtown = null;
  const downtownStations = enriched.filter((s) => inBox(s.lat, s.lon, DOWNTOWN_BBOX));
  if (downtownStations.length >= DOWNTOWN_INSET_THRESHOLD) {
    const downtownSegments = [];
    for (const seg of segments) {
      let current = [];
      let lastWasInside = false;
      for (let i = 0; i < seg.length; i++) {
        const [lat, lon] = seg[i];
        const inside = inBox(lat, lon, DOWNTOWN_BBOX);
        if (inside) {
          // Include the previous point too so segments entering the bbox
          // start from the right edge rather than mid-air.
          if (!lastWasInside && i > 0 && current.length === 0) {
            current.push(seg[i - 1]);
          }
          current.push([lat, lon]);
          lastWasInside = true;
        } else {
          if (lastWasInside) {
            // Bridge one point past the bbox so segments exiting also land
            // smoothly at the edge.
            current.push([lat, lon]);
            downtownSegments.push(current);
            current = [];
          }
          lastWasInside = false;
        }
      }
      if (current.length >= 2) downtownSegments.push(current);
    }

    const inset = projectInto(downtownStations, downtownSegments, {
      width: 240,
      height: 200,
      margin: 14,
    });
    if (inset) {
      // Draw a marker box on the main map showing the area the inset zooms
      // into. Use the main projection (exposed by projectInto) so corners
      // land in the same SVG coordinate space as the main map.
      const c1 = main.project(DOWNTOWN_BBOX.latHi, DOWNTOWN_BBOX.lonLo);
      const c2 = main.project(DOWNTOWN_BBOX.latLo, DOWNTOWN_BBOX.lonHi);
      downtown = {
        stations: inset.stations,
        tracks: inset.tracks,
        width: inset.width,
        height: inset.height,
        mainBoxRect: {
          x: Math.min(c1.x, c2.x),
          y: Math.min(c1.y, c2.y),
          width: Math.abs(c2.x - c1.x),
          height: Math.abs(c2.y - c1.y),
        },
      };
    }
  }

  return {
    width: main.width,
    height: main.height,
    tracks: main.tracks,
    stations: main.stations,
    maxCount,
    downtown,
  };
}
