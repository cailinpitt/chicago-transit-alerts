import { useEffect, useMemo, useRef, useState } from 'react';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { buildStationIndex } from '../lib/stations.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const BUS_ROUTE_LIMIT = 15;
const STATION_LIMIT = 10;

// Top bus routes by incident count within the rolling window. Mirrors
// what `prerender-pages.js` would emit a per-route OG card for, so the
// menu only links to pages that actually have prerendered cards.
function topBusRoutes(alerts, observations, now) {
  if (!alerts || !observations) return [];
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const counts = new Map();
  const bump = (route, ts) => {
    if (ts == null || ts < cutoff) return;
    const key = String(route);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const a of alerts) {
    if (a.kind !== 'bus') continue;
    for (const r of a.routes || []) bump(r, a.first_seen_ts);
  }
  for (const o of observations) {
    if (o.kind !== 'bus') continue;
    bump(o.line, o.ts);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, BUS_ROUTE_LIMIT)
    .map(([id]) => id);
}

function topStations(alerts, observations, now) {
  if (!alerts || !observations) return [];
  const idx = buildStationIndex(alerts, observations, { now, windowDays: WINDOW_DAYS });
  return [...idx.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, STATION_LIMIT);
}

// Browse dropdown surfaced in the Header on every page. Train lines are
// always shown (stable set of 8); bus routes and stations are scoped to
// the rolling 90-day window so the menu reflects what's actually been
// happening recently and matches the OG-card prerendering scope.
export default function BrowseMenu({ alerts, observations }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // Snapshot `now` once at mount so the 90-day window cutoff is stable
  // across re-renders (otherwise useMemo below would invalidate every
  // render via a fresh Date.now()). Browse contents shifting by a few
  // hours of data freshness is fine for a navigation menu.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const busRoutes = useMemo(
    () => topBusRoutes(alerts, observations, now),
    [alerts, observations, now],
  );
  const stations = useMemo(
    () => topStations(alerts, observations, now),
    [alerts, observations, now],
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
      >
        Browse
        <span aria-hidden="true" className="opacity-60">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-30 bg-white dark:bg-gh-surface border border-slate-200 dark:border-gh-border rounded-lg shadow-lg p-3 w-72 max-h-[70vh] overflow-y-auto"
        >
          <div className="space-y-3">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Train lines
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {TRAIN_LINE_ORDER.map((line) => {
                  const info = TRAIN_LINES[line];
                  return (
                    <a
                      key={line}
                      href={`/line/${line}`}
                      role="menuitem"
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: info.color, color: info.textColor }}
                    >
                      {info.label}
                    </a>
                  );
                })}
              </div>
            </section>

            {busRoutes.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Bus routes (last 90d)
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {busRoutes.map((r) => (
                    <a
                      key={r}
                      href={`/route/${r}`}
                      role="menuitem"
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
                    >
                      #{r}
                    </a>
                  ))}
                </div>
              </section>
            )}

            {stations.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Stations (last 90d)
                </h3>
                <ul className="space-y-0.5">
                  {stations.map((s) => (
                    <li key={s.slug}>
                      <a
                        href={`/station/${s.slug}`}
                        role="menuitem"
                        className="block px-2 py-1 rounded text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gh-border transition-colors"
                      >
                        {s.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
