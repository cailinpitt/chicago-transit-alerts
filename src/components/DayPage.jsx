import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { chicagoDayUTC, formatChicagoDay } from '../lib/format.js';
import { filterIncidents, flattenIncidents } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import { dayStringToUtc } from '../lib/urlState.js';
import Header from './Header.jsx';
import IncidentList from './IncidentList.jsx';
import NotFoundPage from './NotFoundPage.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;

// `/day/:date` — focused view of a single Chicago calendar day. Same data
// the homepage shows when you pin a day via the timeline, but as a proper
// permalink: clean URL, dedicated <title>, prerendered OG card.
//
// Rendered content is intentionally minimal — no filter bar (a single-day
// scope makes line/range chips less useful), no full visualizations. Just
// the incidents that touched this day, grouped by line.
export default function DayPage({ dateStr }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Parse the URL date once. Invalid strings (e.g. /day/foo) render a
  // not-found card without bothering to fetch.
  const dayUtc = useMemo(() => dayStringToUtc(dateStr), [dateStr]);
  const dayLabel = dayUtc != null ? formatChicagoDay(dayUtc) : null;

  // Future days never have data; show a friendly state rather than an empty
  // list. Past-but-out-of-window days fall through to the "no incidents"
  // branch (consistent with the rest of the site's 90-day archive).
  const isFuture = useMemo(() => {
    if (dayUtc == null) return false;
    return dayUtc > chicagoDayUTC(now);
  }, [dayUtc, now]);

  useEffect(() => {
    if (dayUtc == null) return;
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, [dayUtc]);

  // Flat view for the station index and Header; the list reads nested incidents.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  // Use the standard filter pipeline pinned to this day — incidents whose
  // [start, end] spans overlap. Active incidents that started before today
  // still surface (their span extends to now).
  const filtered = useMemo(() => {
    if (!data || dayUtc == null) return [];
    return filterIncidents(data.incidents, {
      lines: null,
      startTs: null,
      showBus: true,
      busRoutes: null,
      selectedDay: dayUtc,
      signals: null,
      search: '',
      now,
    });
  }, [data, dayUtc, now]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [flat, now]);

  // Distinct lines/routes touched on this day — drives the breakdown chip
  // row at the top of the page. Trains use brand color pills; buses fall
  // back to plain "#NN" chips.
  const breakdown = useMemo(() => {
    const trains = new Set();
    const buses = new Set();
    for (const inc of filtered) {
      if (inc.kind === 'train') for (const r of inc.routes ?? []) trains.add(r);
      else if (inc.kind === 'bus') for (const r of inc.routes ?? []) buses.add(String(r));
    }
    return { trains: [...trains], buses: [...buses].sort() };
  }, [filtered]);

  const totalCount = filtered.length;

  useEffect(() => {
    const base = 'Chicago Transit Alerts';
    if (!dayLabel) {
      document.title = base;
      return;
    }
    document.title = `${dayLabel} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [dayLabel]);

  if (dayUtc == null) {
    return <NotFoundPage />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  // Neighbor links — yesterday / tomorrow — so it's easy to walk through a
  // streak of bad days. Tomorrow is hidden when it'd land in the future.
  const prevStr = new Date(dayUtc - DAY_MS).toISOString().slice(0, 10);
  const nextStr = new Date(dayUtc + DAY_MS).toISOString().slice(0, 10);
  const showNext = dayUtc + DAY_MS <= chicagoDayUTC(now);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={flat?.alerts}
        observations={flat?.observations}
      />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full flex-1">
        <div>
          <a
            href="/"
            className="text-sm text-blue-500 hover:text-blue-400 hover:underline inline-block mb-3"
          >
            ← Back to all incidents
          </a>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{dayLabel}</h1>
            {data && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {totalCount} incident{totalCount === 1 ? '' : 's'}
                {isFuture ? ' — future date' : ''}
              </span>
            )}
          </div>
          {/* Line/route pills touched this day */}
          {data && (breakdown.trains.length > 0 || breakdown.buses.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {breakdown.trains.map((line) => {
                const info = TRAIN_LINES[line];
                if (!info) return null;
                return (
                  <a
                    key={line}
                    href={`/line/${line}`}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: info.color, color: info.textColor }}
                  >
                    {info.label}
                  </a>
                );
              })}
              {breakdown.buses.map((route) => (
                <a
                  key={route}
                  href={`/route/${route}`}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-slate-500 text-white hover:opacity-80 transition-opacity"
                >
                  #{route}
                </a>
              ))}
            </div>
          )}
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {data && totalCount === 0 && !isFuture && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
            No incidents on record for {dayLabel}.
          </div>
        )}

        {data && totalCount > 0 && (
          <IncidentList
            incidents={filtered}
            search=""
            onSearchChange={null}
            stationIndex={stationIndex}
            isFiltered
          />
        )}

        {data && (
          <div className="flex justify-between items-center text-sm pt-2">
            <a
              href={`/day/${prevStr}`}
              className="text-blue-500 hover:text-blue-400 hover:underline"
            >
              ← Previous day
            </a>
            {showNext ? (
              <a
                href={`/day/${nextStr}`}
                className="text-blue-500 hover:text-blue-400 hover:underline"
              >
                Next day →
              </a>
            ) : (
              <span />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
