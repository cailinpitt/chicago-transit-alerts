import { useMemo } from 'react';
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
export default function EventMap({ lineKey, fromStation, toStation }) {
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

  const info = TRAIN_LINES[lineKey];
  const accent = info?.color ?? '#475569';
  const trackPaths = map.tracks
    .filter((t) => t.length >= 2)
    .map((t) => `M${t.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`);

  // When both endpoints are present and distinct, draw a bold straight
  // chord between them in the line color. The track itself curves — the
  // chord doesn't try to follow it (computing the polyline subset that
  // connects two stations is fiddly), but visually the chord plus the two
  // highlighted dots is enough to say "this is the stretch."
  const fromDot = fromStation
    ? affected.find((s) => normalize(s.name) === normalize(fromStation))
    : null;
  const toDot = toStation ? affected.find((s) => normalize(s.name) === normalize(toStation)) : null;
  const drawChord = fromDot && toDot && fromDot !== toDot;

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Where this happened
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="relative overflow-x-auto">
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
              {drawChord && (
                <line
                  x1={fromDot.x}
                  y1={fromDot.y}
                  x2={toDot.x}
                  y2={toDot.y}
                  stroke={accent}
                  strokeWidth={5}
                  strokeLinecap="round"
                  opacity={0.55}
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
            {/* HTML labels for affected stations. With two adjacent
                affected stations the naive "above/below by map half"
                placement collides (Purple's Central + Noyes both label
                above their dots and overlap). When there are exactly two,
                force one label above and one below regardless of map
                position so they can't overlap. */}
            {(() => {
              const twoAdjacent = affected.length === 2;
              return affected.map((s, idx) => {
                const leftPct = (s.x / map.width) * 100;
                const topPct = (s.y / map.height) * 100;
                const xRatio = s.x / map.width;
                let xTransform;
                if (xRatio < 0.25) xTransform = '10px';
                else if (xRatio > 0.75) xTransform = 'calc(-100% - 10px)';
                else xTransform = '-50%';
                // For two-station events: first label above, second below.
                // For everything else: keep the map-half heuristic.
                const above = twoAdjacent ? idx === 0 : s.y < map.height / 2;
                const yTransform = above ? 'calc(-100% - 12px)' : '14px';
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
        </div>
      </div>
    </section>
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
