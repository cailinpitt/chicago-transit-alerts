import { useEffect, useMemo, useRef } from 'react';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { hexToRgba } from '../lib/format.js';
import { buildLineMap } from '../lib/lineMap.js';
import { displayStationName } from '../lib/stations.js';

// Light-touch event-scoped map: full line track in muted color, with the
// stations involved in this incident highlighted as bold dots with labels.
// Distinct from LineMap (which heat-colors stations by 90-day count) — this
// view is about "where THIS happened," not the line's history.
//
// Renders nothing when:
//   - The incident isn't on a train (no geometry data for buses).
//   - We can't resolve at least one of the affected stations against the
//     line's station list. Falling back to a blank map would be misleading.
//
// `from` / `to` station names come from either an observation (from_station/
// to_station) or an alert (affected_from_station/affected_to_station); the
// caller normalizes which fields to pass.
export default function EventMap({ lineKey, fromStation, toStation, active = false }) {
  const map = useMemo(
    () => buildLineMap(lineKey, null, { maxWidth: 720, maxHeight: 320 }),
    [lineKey],
  );

  if (!map) return null;

  // Lookup affected stations by exact name match — slugify on both sides
  // so case/punctuation differences don't tank the match.
  const wantedNames = new Set();
  if (fromStation) wantedNames.add(normalize(fromStation));
  if (toStation) wantedNames.add(normalize(toStation));
  if (wantedNames.size === 0) return null;

  const affected = map.stations.filter((s) => wantedNames.has(normalize(s.name)));
  if (affected.length === 0) return null;

  // Center of the affected segment in SVG coords. Used by the scroll-on-mount
  // effect below to put the impacted section in view on narrow screens where
  // the map's minWidth (480px) exceeds the viewport.
  const affectedCenterX = affected.reduce((sum, s) => sum + s.x, 0) / affected.length;

  const info = TRAIN_LINES[lineKey];
  const accent = info?.color ?? '#475569';
  const trackPaths = map.tracks
    .filter((t) => t.length >= 2)
    .map((t) => `M${t.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`);

  // Highlight the actual segment of track between the two affected stations
  // (when both endpoints are present and distinct). For each polyline in
  // map.tracks, find the points closest to the two stations and slice the
  // polyline between those indices. A straight chord would shortcut bends
  // — Blue Line Clark/Lake → Chicago turns 90° underground; the chord
  // version cut across through other paths and looked wrong.
  let highlightPath = null;
  if (affected.length === 2) {
    const [a, b] = affected;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const track of map.tracks) {
      if (!track || track.length < 2) continue;
      let aIdx = -1;
      let bIdx = -1;
      let aBest = Number.POSITIVE_INFINITY;
      let bBest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < track.length; i++) {
        const dxa = track[i].x - a.x;
        const dya = track[i].y - a.y;
        const da = dxa * dxa + dya * dya;
        if (da < aBest) {
          aBest = da;
          aIdx = i;
        }
        const dxb = track[i].x - b.x;
        const dyb = track[i].y - b.y;
        const db = dxb * dxb + dyb * dyb;
        if (db < bBest) {
          bBest = db;
          bIdx = i;
        }
      }
      // Score: how well does this polyline cover BOTH stations? Lower is
      // better. A polyline that's the wrong branch (Forest Park when the
      // incident is on the O'Hare side, e.g.) will have one station far
      // off and lose to the correct branch.
      const score = aBest + bBest;
      if (aIdx >= 0 && bIdx >= 0 && score < bestScore) {
        bestScore = score;
        const lo = Math.min(aIdx, bIdx);
        const hi = Math.max(aIdx, bIdx);
        // Bookend with the station's exact (x, y) so the highlight visually
        // meets the dot center rather than the closest polyline knee.
        const slice = track.slice(lo, hi + 1);
        const startStation = aIdx <= bIdx ? a : b;
        const endStation = aIdx <= bIdx ? b : a;
        const points = [startStation, ...slice, endStation];
        highlightPath = `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;
      }
    }
  }

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        {active ? 'Where this is happening' : 'Where this happened'}
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <MapScroller
          mapWidth={map.width}
          affectedCenterX={affectedCenterX}
          affectedKey={affected.map((s) => s.name).join('|')}
        >
          <div className="relative" style={{ minWidth: Math.min(map.width, 480), width: '100%' }}>
            <svg
              viewBox={`0 0 ${map.width} ${map.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`Affected stretch on the ${info?.label ?? lineKey} Line`}
              className="block w-full h-auto"
            >
              <title>{`Affected stretch on the ${info?.label ?? lineKey} Line`}</title>
              {/* Track — dimmed compared to LinePage's map so the affected
                  segment chord pops as the foreground element. */}
              {trackPaths.map((d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke={hexToRgba(accent, 0.25)}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {highlightPath && (
                <path
                  d={highlightPath}
                  fill="none"
                  stroke={accent}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
              )}
              {/* Quiet dots for context — every other station on the line
                  renders as a small gray circle. Keeps the map readable
                  but visually subordinate to the highlighted ones. */}
              {map.stations
                .filter((s) => !affected.includes(s))
                .map((s) => (
                  <circle
                    key={s.name}
                    cx={s.x}
                    cy={s.y}
                    r={2.5}
                    fill="#cbd5e1"
                    className="dark:[fill:#475569]"
                  >
                    <title>{displayStationName(s.name)}</title>
                  </circle>
                ))}
              {/* Affected stations — bold, brand color, larger radius. */}
              {affected.map((s) => {
                const href = s.slug ? `/station/${s.slug}` : null;
                const dot = (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={6}
                    fill={accent}
                    stroke="white"
                    strokeWidth={2}
                    className="dark:[stroke:#0d1117]"
                  >
                    <title>{displayStationName(s.name)}</title>
                  </circle>
                );
                if (href) {
                  return (
                    <a
                      key={s.name}
                      href={href}
                      aria-label={`${displayStationName(s.name)} station page`}
                    >
                      {dot}
                    </a>
                  );
                }
                // biome-ignore lint/correctness/useJsxKeyInIterable: parent <g> carries the key for this iteration
                return <g key={s.name}>{dot}</g>;
              })}
            </svg>
            {/* HTML labels for affected stations. Each label is placed on
                the side of its dot pointing AWAY from the other affected
                dot — so the two labels diverge outward from the segment
                rather than landing between the dots (which historically
                made e.g. Blue Line Chicago/Clark-Lake look swapped).
                Single-station events default to above. */}
            {(() => {
              const midX =
                affected.length > 1
                  ? affected.reduce((sum, s) => sum + s.x, 0) / affected.length
                  : null;
              const midY =
                affected.length > 1
                  ? affected.reduce((sum, s) => sum + s.y, 0) / affected.length
                  : null;
              return affected.map((s) => {
                const leftPct = (s.x / map.width) * 100;
                const topPct = (s.y / map.height) * 100;
                // Multi-station: bias each label away from the segment's
                // midpoint so labels live on the outer side of each dot.
                // Tiebreak (when stations sit on a perfectly vertical or
                // horizontal line) defaults to upper/leftward.
                let above;
                let leftOfDot;
                if (midY != null) {
                  above = s.y <= midY;
                  leftOfDot = s.x <= midX;
                } else {
                  above = s.y < map.height / 2;
                  leftOfDot = s.x > map.width / 2;
                }
                // Horizontal: anchor opposite the bias direction so the
                // label grows AWAY from the other dot — left-of-midpoint
                // station gets a right-anchored label (grows left), and
                // vice versa. Then clamp at the canvas edges so we never
                // clip into card padding.
                const xRatio = s.x / map.width;
                let xTransform;
                if (xRatio < 0.08) xTransform = '0';
                else if (xRatio > 0.92) xTransform = '-100%';
                else xTransform = leftOfDot ? 'calc(-100% - 6px)' : '6px';
                const yTransform = above ? 'calc(-100% - 8px)' : '10px';
                return (
                  <span
                    key={`label-${s.name}`}
                    className="absolute pointer-events-none whitespace-nowrap text-[11px] font-semibold text-slate-700 dark:text-slate-200 [text-shadow:0_0_3px_white,0_0_3px_white,0_0_3px_white] dark:[text-shadow:0_0_3px_#161b22,0_0_3px_#161b22,0_0_3px_#161b22]"
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      transform: `translate(${xTransform}, ${yTransform})`,
                    }}
                  >
                    {displayStationName(s.name)}
                  </span>
                );
              });
            })()}
          </div>
        </MapScroller>
      </div>
    </section>
  );
}

// Horizontally-scrollable wrapper that, on mount, scrolls the affected
// segment into view. The map's inner content has a 480px minWidth, which
// exceeds many phone viewports — without this, narrow viewports default to
// scrollLeft: 0, hiding incidents that sit on the right side of the line
// (e.g. Blue Line's O'Hare branch). `affectedKey` re-runs the scroll when
// the highlighted stations change, so navigating between events updates
// the framing instead of stuck at the previous segment's position.
function MapScroller({ mapWidth, affectedCenterX, affectedKey, children }) {
  const ref = useRef(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: affectedKey captures the affected-stations identity
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Inner content is `width: 100%` with `minWidth: min(mapWidth, 480)`, so
    // the rendered width equals max(visible, 480) up to mapWidth. Use the
    // actual scrollWidth so the math is correct regardless.
    const innerWidth = el.scrollWidth;
    const visible = el.clientWidth;
    if (innerWidth <= visible) return; // nothing to scroll
    const targetPx = (affectedCenterX / mapWidth) * innerWidth;
    const desired = targetPx - visible / 2;
    const max = innerWidth - visible;
    el.scrollLeft = Math.max(0, Math.min(max, desired));
  }, [affectedKey, affectedCenterX, mapWidth]);
  return (
    <div ref={ref} className="relative overflow-x-auto">
      {children}
    </div>
  );
}

// Loose equality for station name matching — strip whitespace, lowercase,
// drop trailing parenthetical line qualifiers ("Central (Green)"). The
// upstream sources occasionally vary on these details and we'd rather
// surface a match than a blank map.
function normalize(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}
