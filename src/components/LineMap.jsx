import { useMemo } from 'react';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { hexToRgba } from '../lib/format.js';
import { buildLineMap } from '../lib/lineMap.js';

// Five intensity stops keyed off the line's max station count so the
// busiest station is fully saturated and the rest scale linearly. Mirrors
// the existing Calendar / Hour-of-Week heatmap conventions for visual
// consistency across the site.
function stationFill(count, maxCount, baseColor) {
  if (count === 0 || maxCount <= 0) return 'var(--timeline-empty)';
  const ratio = count / maxCount;
  if (ratio < 0.2) return hexToRgba(baseColor, 0.35);
  if (ratio < 0.4) return hexToRgba(baseColor, 0.55);
  if (ratio < 0.7) return hexToRgba(baseColor, 0.75);
  if (ratio < 0.9) return hexToRgba(baseColor, 0.9);
  return baseColor;
}

// Compose an SVG `path` `d` attribute for a polyline. Skip lines with
// fewer than 2 points (would render nothing useful anyway).
function pathFor(track) {
  return `M${track.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;
}

function StationDot({ station, maxCount, accent, radius = 5 }) {
  const fill = stationFill(station.count, maxCount, accent);
  const label =
    station.count === 0
      ? `${station.name}: no incidents (last 90 days)`
      : `${station.name}: ${station.count} incident${station.count === 1 ? '' : 's'} (last 90 days)`;
  const href = station.slug ? `/station/${station.slug}` : null;
  const circle = (
    <circle
      cx={station.x}
      cy={station.y}
      r={radius}
      fill={fill}
      stroke="white"
      strokeWidth={1.5}
      className="dark:[stroke:#0d1117]"
    >
      <title>{label}</title>
    </circle>
  );
  if (!href || station.count === 0) return circle;
  return (
    <a href={href} aria-label={label}>
      {circle}
    </a>
  );
}

// SVG geographic heatmap of stations along a single train line, colored by
// their incident count over the rolling window. Hidden when there's no data
// for the line at all (geography missing or wrong line key) — the caller
// shouldn't paper over a blank rendering with a "no data" placeholder.
//
// When ≥4 stations cluster downtown (true for every line except Yellow),
// a zoom inset is rendered in the lower-right corner so the dense Loop
// stations are individually clickable rather than overlapping dots.
export default function LineMap({ lineKey, stationIndex }) {
  const map = useMemo(
    () => buildLineMap(lineKey, stationIndex, { width: 720, height: 360, margin: 18 }),
    [lineKey, stationIndex],
  );
  if (!map) return null;
  const info = TRAIN_LINES[lineKey];
  const accent = info?.color ?? '#475569';

  const trackPaths = map.tracks.filter((t) => t.length >= 2).map(pathFor);
  const inset = map.downtown;
  const insetTracks = inset ? inset.tracks.filter((t) => t.length >= 2).map(pathFor) : [];
  // Position the inset in the lower-right with a small gutter from the
  // main SVG edge.
  const insetX = inset ? map.width - inset.width - 8 : 0;
  const insetY = inset ? map.height - inset.height - 8 : 0;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Stations by 90-day incident count
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        {/* Horizontal scroll on narrow viewports — at phone width the SVG
            would compress to where station dots overlap and become
            untappable. Min-width keeps the geometry legible; the gradient
            edge mirrors the Timeline pattern as a scroll affordance. */}
        <div className="relative overflow-x-auto">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-white dark:from-gh-surface to-transparent sm:hidden"
          />
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${info?.label ?? lineKey} Line stations heatmap`}
            className="block h-auto"
            style={{ minWidth: 640, width: '100%' }}
          >
            <title>{`${info?.label ?? lineKey} Line stations`}</title>
            {/* Track segments — colored at brand opacity 0.35 so stations
                pop against the line. Stroke matches the line's brand color. */}
            {trackPaths.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke={hexToRgba(accent, 0.35)}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* Stations on the main map */}
            {map.stations.map((s) => (
              <StationDot
                key={s.name}
                station={s}
                maxCount={map.maxCount}
                accent={accent}
                radius={6}
              />
            ))}

            {/* Downtown inset — separate nested SVG so it has its own
                coordinate space. Background panel + connector rectangle
                outline showing the area being zoomed. */}
            {inset && (
              <>
                <rect
                  x={map.downtown.mainBoxRect.x}
                  y={map.downtown.mainBoxRect.y}
                  width={map.downtown.mainBoxRect.width}
                  height={map.downtown.mainBoxRect.height}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  rx={3}
                />
                <g transform={`translate(${insetX}, ${insetY})`}>
                  <rect
                    x={0}
                    y={0}
                    width={inset.width}
                    height={inset.height}
                    rx={6}
                    fill="white"
                    stroke="#cbd5e1"
                    strokeWidth={1}
                    className="dark:[fill:#161b22] dark:[stroke:#30363d]"
                  />
                  <text
                    x={10}
                    y={14}
                    fontSize={10}
                    fontWeight={700}
                    fill="#64748b"
                    style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
                  >
                    Downtown
                  </text>
                  {/* Inset content lives in the same SVG coord space —
                      already projected into [0..insetW, 0..insetH] by
                      buildLineMap, so no extra transform needed. */}
                  {insetTracks.map((d) => (
                    <path
                      key={`inset-${d}`}
                      d={d}
                      fill="none"
                      stroke={hexToRgba(accent, 0.35)}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {inset.stations.map((s) => (
                    <StationDot
                      key={`inset-${s.name}`}
                      station={s}
                      maxCount={map.maxCount}
                      accent={accent}
                      radius={5}
                    />
                  ))}
                </g>
              </>
            )}
          </svg>
        </div>

        {/* Legend mirrors the calendar/hour-grid scale */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500">Less</span>
            <div className="flex gap-0.5">
              {[0, 0.1, 0.3, 0.55, 0.8, 1].map((r) => {
                const count = Math.ceil(r * Math.max(map.maxCount, 1));
                return (
                  <div
                    key={r}
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor:
                        r === 0
                          ? 'var(--timeline-empty)'
                          : stationFill(count, Math.max(map.maxCount, 1), accent),
                    }}
                  />
                );
              })}
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500">More</span>
          </div>
          <span className="text-xs text-slate-300 dark:text-slate-600">
            · Each dot = one station · Click for the station's incident history
            {inset ? ' · Downtown stations zoomed bottom-right' : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
