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

// SVG geographic heatmap of stations along a single train line, colored by
// their incident count over the rolling window. Hidden when there's no data
// for the line at all (geography missing or wrong line key) — the caller
// shouldn't paper over a blank rendering with a "no data" placeholder.
export default function LineMap({ lineKey, stationIndex }) {
  const map = useMemo(
    () => buildLineMap(lineKey, stationIndex, { width: 720, height: 360, margin: 18 }),
    [lineKey, stationIndex],
  );
  if (!map) return null;
  const info = TRAIN_LINES[lineKey];
  const accent = info?.color ?? '#475569';

  // Build the polyline path for each track segment as one SVG `path` so the
  // line renders as a continuous stroke rather than a chain of lines. Skip
  // tracks with fewer than 2 points (would render nothing useful anyway).
  const trackPaths = map.tracks
    .filter((t) => t.length >= 2)
    .map((t) => `M${t.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`);

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Stations by 90-day incident count
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${info?.label ?? lineKey} Line stations heatmap`}
            className="w-full h-auto block"
            style={{ minHeight: 200 }}
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
            {/* Stations — circle per stop. Each circle has a <title> child
                for native browser tooltips with the station name + count. */}
            {map.stations.map((s) => {
              const fill = stationFill(s.count, map.maxCount, accent);
              const label =
                s.count === 0
                  ? `${s.name}: no incidents (last 90 days)`
                  : `${s.name}: ${s.count} incident${s.count === 1 ? '' : 's'} (last 90 days)`;
              const href = s.slug ? `/station/${s.slug}` : null;
              const circle = (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={5}
                  fill={fill}
                  stroke="white"
                  strokeWidth={1.5}
                  className="dark:[stroke:#0d1117]"
                >
                  <title>{label}</title>
                </circle>
              );
              if (!href || s.count === 0) return <g key={s.name}>{circle}</g>;
              return (
                <a key={s.name} href={href} aria-label={label}>
                  {circle}
                </a>
              );
            })}
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
          </span>
        </div>
      </div>
    </section>
  );
}
