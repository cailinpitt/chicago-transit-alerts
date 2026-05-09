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

// Terminal stations per line. Used as anchors for the only labels we render
// on the main map — labeling every station overcrowds the SVG, but flagging
// the endpoints gives a rider enough context to orient ("Howard at the top,
// 95th at the bottom"). Names match trainStations.json exactly.
const LINE_TERMINALS = {
  red: ['Howard', '95th/Dan Ryan'],
  blue: ["O'Hare", 'Forest Park'],
  brown: ['Kimball'],
  green: ['Harlem/Lake', 'Ashland/63rd', 'Cottage Grove'],
  orange: ['Midway'],
  pink: ['54th/Cermak'],
  purple: ['Linden', 'Howard'],
  yellow: ['Dempster-Skokie', 'Howard'],
};

export function shortCodeFor(lineKey) {
  return FULL_TO_SHORT[lineKey] ?? lineKey;
}

function inBox(lat, lon, bbox) {
  return lat >= bbox.latLo && lat <= bbox.latHi && lon >= bbox.lonLo && lon <= bbox.lonHi;
}

// Project a set of stations + track segments into a target SVG box.
//
// `maxWidth` / `maxHeight` are upper bounds. The actual returned SVG
// dimensions are computed from the input's natural aspect ratio (after
// latitude-cosine correction so distances scale equivalently in x and y).
//
// `rotate: true` rotates the projection 90° counter-clockwise: north → left,
// south → right. Used for very vertical lines (Red, Purple) so the SVG
// stays landscape-ish rather than becoming a tall narrow strip that demands
// page scroll to get past.
function projectInto(
  rawStations,
  segments,
  { maxWidth, maxHeight, margin, minHeight = 200, rotate = false },
) {
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

  // Cosine-of-latitude correction: 1° of longitude is shorter than 1° of
  // latitude in distance terms. At Chicago (~41.85°N) the ratio is ~0.74.
  // Multiplying lonRange by this factor lets us treat them as equivalent
  // distances downstream, so the rendered map preserves visual scale.
  const meanLat = (minLat + maxLat) / 2;
  const lonScaleCorrection = Math.cos((meanLat * Math.PI) / 180);
  const effectiveLonRange = lonRange * lonScaleCorrection;

  // After rotation, latitude span drives the horizontal axis and longitude
  // span drives the vertical axis. Compute the effective horizontal/vertical
  // ranges based on orientation.
  const xRange = rotate ? latRange : effectiveLonRange;
  const yRange = rotate ? effectiveLonRange : latRange;
  const aspect = xRange / yRange; // wider-than-tall when > 1

  // Pick natural dimensions from the aspect ratio, bounded by the caller's
  // maxes. Wider lines fill maxWidth and shrink height; taller lines fill
  // maxHeight and shrink width. minHeight prevents an extremely wide line
  // (e.g. a hypothetical horizontal trunk) from collapsing to a thin strip.
  let width;
  let height;
  if (aspect >= 1) {
    width = maxWidth;
    height = Math.max(minHeight, Math.min(maxHeight, Math.round(maxWidth / aspect)));
  } else {
    height = maxHeight;
    width = Math.max(minHeight, Math.min(maxWidth, Math.round(maxHeight * aspect)));
  }

  const innerW = width - 2 * margin;
  const innerH = height - 2 * margin;
  // Same scale on both axes so geometry stays distortion-free.
  const scale = Math.min(innerW / xRange, innerH / yRange);
  const projW = xRange * scale;
  const projH = yRange * scale;
  const offX = margin + (innerW - projW) / 2;
  const offY = margin + (innerH - projH) / 2;

  // 90° CCW: north → left (x grows toward south), east → top (y grows
  // toward west). Default (no rotate): east → right, north → top.
  const project = rotate
    ? (lat, lon) => ({
        x: offX + (maxLat - lat) * scale,
        y: offY + (maxLon - lon) * lonScaleCorrection * scale,
      })
    : (lat, lon) => ({
        x: offX + (lon - minLon) * lonScaleCorrection * scale,
        y: offY + (maxLat - lat) * scale,
      });

  const projectedStations = rawStations.map((s) => ({
    name: s.name,
    slug: s.slug,
    count: s.count,
    isTerminal: !!s.isTerminal,
    ...project(s.lat, s.lon),
  }));
  const projectedTracks = segments.map((seg) => seg.map(([lat, lon]) => project(lat, lon)));

  return {
    width,
    height,
    stations: projectedStations,
    tracks: projectedTracks,
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
 * @param {number} [options.maxWidth]
 * @param {number} [options.maxHeight]
 * @param {number} [options.margin]
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
 *     mainBoxRect: { x: number, y: number, width: number, height: number } | null,
 *   },
 * } | null}
 */
export function buildLineMap(
  lineKey,
  stationIndex = null,
  { maxWidth = 720, maxHeight = 540, margin = 24 } = {},
) {
  if (!TRAIN_LINE_ORDER.includes(lineKey)) return null;
  const short = shortCodeFor(lineKey);
  const segments = lines[short];
  const lineStations = stations.filter((s) => Array.isArray(s.lines) && s.lines.includes(short));
  if (!segments || lineStations.length === 0) return null;

  // Annotate stations with their incident counts up front so both projections
  // share the same enriched records. `isTerminal` flags endpoint stations
  // for the renderer, which uses it to attach text labels.
  const terminals = new Set(LINE_TERMINALS[lineKey] ?? []);
  const enriched = lineStations.map((s) => {
    const slug = slugifyStation(s.name);
    const count = slug && stationIndex ? (stationIndex.get(slug)?.count ?? 0) : 0;
    return {
      name: s.name,
      slug,
      lat: s.lat,
      lon: s.lon,
      count,
      isTerminal: terminals.has(s.name),
    };
  });

  // Detect a "very vertical" line and rotate it 90° CCW so the SVG stays
  // landscape. Threshold is in distance-corrected aspect (effective lonRange
  // / latRange). Below 0.5 the line is more than 2x taller than wide; render
  // sideways instead.
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const s of enriched) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  const meanLat = (minLat + maxLat) / 2;
  const cosCorrection = Math.cos((meanLat * Math.PI) / 180);
  const naturalAspect =
    (Math.max(maxLon - minLon, 1e-6) * cosCorrection) / Math.max(maxLat - minLat, 1e-6);
  const rotate = naturalAspect < 0.5;

  const main = projectInto(enriched, segments, {
    maxWidth,
    maxHeight: rotate ? 240 : maxHeight,
    margin,
    rotate,
  });
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
      maxWidth: 320,
      maxHeight: 280,
      margin: 14,
      minHeight: 160,
      // Match the main map's orientation so the dashed "zoom here" rect on
      // the main lines up with the inset's geometry — if main is rotated
      // sideways, the inset should be too.
      rotate,
    });
    if (inset) {
      // Marker rect on the main map showing the area the inset zooms into.
      // Same coordinate space as the main projection.
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
