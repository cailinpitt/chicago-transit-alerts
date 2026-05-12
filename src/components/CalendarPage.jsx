import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { buildCalendarMonths, maxCountAcrossMonths } from '../lib/calendar.js';
import { buildSearch, parseUrlState } from '../lib/urlState.js';
import Filters from './Filters.jsx';
import Header from './Header.jsx';

const MONTHS_BACK = 12;

const NO_DATA_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(-45deg, var(--no-data-stripe1) 0px, var(--no-data-stripe1) 1px, var(--no-data-stripe2) 1px, var(--no-data-stripe2) 4px)',
};

// Five intensity stops keyed off the max count, so the busiest day is fully
// saturated and the rest scale linearly. Mirrors HourOfWeekHeatmap's pattern
// for visual consistency across the site.
function cellBg(count, maxCount) {
  if (count === 0 || maxCount <= 0) return 'var(--timeline-empty)';
  const ratio = count / maxCount;
  if (ratio < 0.2) return 'rgba(100, 116, 139, 0.25)';
  if (ratio < 0.4) return 'rgba(100, 116, 139, 0.45)';
  if (ratio < 0.7) return 'rgba(100, 116, 139, 0.65)';
  if (ratio < 0.9) return 'rgba(100, 116, 139, 0.85)';
  return 'rgb(71, 85, 105)';
}

function CalendarCell({ cell, maxCount }) {
  if (cell.placeholder) {
    // Days that don't exist in this month (e.g. Feb 30). Empty slot keeps
    // the 31-column grid aligned across months of different lengths.
    return <div aria-hidden="true" />;
  }
  if (cell.future) {
    return (
      <div
        aria-hidden="true"
        className="rounded-sm aspect-square opacity-40"
        style={{ backgroundColor: 'var(--timeline-empty)' }}
      />
    );
  }
  if (cell.noData) {
    const label = `${cell.date}: no data`;
    return (
      <div
        role="img"
        title={label}
        aria-label={label}
        className="rounded-sm aspect-square"
        style={NO_DATA_STYLE}
      />
    );
  }
  const label =
    cell.count === 0
      ? `${cell.date}: no incidents`
      : `${cell.date}: ${cell.count} incident${cell.count === 1 ? '' : 's'} (${cell.trainCount} train, ${cell.busCount} bus)`;
  return (
    <a
      href={`/?day=${cell.date}`}
      title={label}
      aria-label={label}
      className="rounded-sm aspect-square hover:ring-1 hover:ring-slate-400 dark:hover:ring-slate-500 transition-all"
      style={{ backgroundColor: cellBg(cell.count, maxCount) }}
    >
      <span className="sr-only">{label}</span>
    </a>
  );
}

function CalendarMonth({ month, maxCount }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 flex-shrink-0 text-right">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {month.label}
        </span>
      </div>
      <div
        className="flex-1 grid gap-1"
        style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}
      >
        {month.cells.map((cell) => (
          <CalendarCell
            key={`${month.year}-${month.month}-${cell.dayOfMonth}`}
            cell={cell}
            maxCount={maxCount}
          />
        ))}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Calendar respects the same filter chips the homepage exposes so a user
  // moving from "Red Line" on the homepage to the calendar keeps the lens.
  // Date-range and pinned-day are intentionally ignored — the 12-month grid
  // is its own time scope. Signal filter is read from the URL for state
  // continuity but doesn't change cell counts (daily-counts.json carries no
  // per-signal breakdown); a small note explains that when active.
  const initial = useMemo(() => parseUrlState(), []);
  const [selectedLines, setSelectedLines] = useState(initial.selectedLines);
  const [showBus, setShowBus] = useState(initial.showBus);
  const [selectedBusRoutes, setSelectedBusRoutes] = useState(initial.selectedBusRoutes);
  const [selectedSignals, setSelectedSignals] = useState(initial.selectedSignals);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/daily-counts.json`;
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  // Also load alerts.json so the Header's Browse menu works on this page,
  // matching the pattern used by LinePage / StationPage. Cheaper than
  // refactoring Header to make data optional everywhere.
  const [browseData, setBrowseData] = useState(null);
  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setBrowseData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = 'Calendar · CTA Alert History';
    return () => {
      document.title = 'CTA Alert History';
    };
  }, []);

  // Mirror filter selections to the URL so calendar views stay shareable.
  useEffect(() => {
    const qs = buildSearch({
      selectedLines,
      showBus,
      selectedBusRoutes,
      dateRange: 7, // calendar ignores dateRange — pin to default so it's omitted from the URL
      selectedDay: null,
      selectedSignals,
      search: '',
    });
    const next = `${window.location.pathname}${qs}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, [selectedLines, showBus, selectedBusRoutes, selectedSignals]);

  const availableBusRoutes = useMemo(() => {
    const routes = new Set();
    for (const d of data?.days || []) {
      if (d.by_route && typeof d.by_route === 'object') {
        for (const k of Object.keys(d.by_route)) routes.add(k);
      }
    }
    return [...routes].sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
      if (Number.isNaN(na)) return 1;
      if (Number.isNaN(nb)) return -1;
      return na - nb || a.localeCompare(b);
    });
  }, [data]);

  // Filters object passed to buildCalendarMonths. Null sentinel when every
  // chip is at default — keeps the original "all train + all bus" path so
  // the most common load doesn't pay for `by_line`/`by_route` traversal.
  const isFiltered =
    selectedLines !== null ||
    !showBus ||
    selectedBusRoutes.length > 0 ||
    selectedSignals.length > 0;
  const filterArgs = useMemo(
    () => (isFiltered ? { selectedLines, showBus, selectedBusRoutes } : null),
    [isFiltered, selectedLines, showBus, selectedBusRoutes],
  );

  const months = useMemo(() => {
    if (!data) return [];
    return buildCalendarMonths(data.days || [], {
      now,
      monthsBack: MONTHS_BACK,
      dataStartTs: data.data_start_ts ?? null,
      filters: filterArgs,
    });
  }, [data, now, filterArgs]);

  const maxCount = useMemo(() => maxCountAcrossMonths(months), [months]);

  const totalCount = useMemo(() => {
    if (!data) return 0;
    let s = 0;
    for (const m of months) {
      for (const cell of m.cells) {
        if (cell.placeholder || cell.noData || cell.future) continue;
        s += cell.count;
      }
    }
    return s;
  }, [data, months]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={browseData?.alerts}
        observations={browseData?.observations}
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
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Calendar</h1>
            {data && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {totalCount} incident{totalCount === 1 ? '' : 's'}
                {isFiltered ? ' match the current filters' : ' on record'} · click a day to drill in
              </span>
            )}
          </div>
        </div>

        {data && (
          <div className="bg-slate-100/60 dark:bg-gh-surface/60 rounded-lg border border-slate-200 dark:border-gh-border px-3 py-2">
            <Filters
              selectedLines={selectedLines}
              onLinesChange={(next) =>
                setSelectedLines(typeof next === 'function' ? next(selectedLines) : next)
              }
              showBus={showBus}
              onShowBusChange={(val) => {
                setShowBus(val);
                if (!val) setSelectedBusRoutes([]);
              }}
              availableBusRoutes={availableBusRoutes}
              selectedBusRoutes={selectedBusRoutes}
              onBusRoutesChange={(next) =>
                setSelectedBusRoutes(typeof next === 'function' ? next(selectedBusRoutes) : next)
              }
              // Calendar's time scope is fixed at 12 months — hide the
              // range/pinned-day controls so users don't click inert chips.
              hideDateRange
              dateRange={7}
              onDateRangeChange={() => {}}
              selectedDay={null}
              onClearSelectedDay={() => {}}
              selectedSignals={selectedSignals}
              onSignalsChange={(next) =>
                setSelectedSignals(typeof next === 'function' ? next(selectedSignals) : next)
              }
            />
            {selectedSignals.length > 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                Signal filter doesn't apply to the calendar — daily breakdowns aren't kept per
                signal. Cell counts reflect line/route filters only.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-red-600 text-sm">Failed to load calendar data.</p>}

        {!error && !data && (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder rows
                key={i}
                className="h-8 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border"
              />
            ))}
          </div>
        )}

        {data && (
          <section>
            <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
              {/* Day-of-month header row */}
              <div className="flex items-center gap-3 mb-2">
                <div className="w-32 flex-shrink-0" />
                <div
                  className="flex-1 grid gap-1"
                  style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <div key={d} className="text-center">
                      {[1, 5, 10, 15, 20, 25, 30].includes(d) && (
                        <span
                          className="text-slate-400 dark:text-slate-500"
                          style={{ fontSize: 10 }}
                        >
                          {d}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {months.map((m) => (
                  <CalendarMonth key={`${m.year}-${m.month}`} month={m} maxCount={maxCount} />
                ))}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-3 border-t border-slate-100 dark:border-gh-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 dark:text-slate-500">Less</span>
                  <div className="flex gap-0.5">
                    {[0, 0.1, 0.3, 0.55, 0.8, 1].map((r) => {
                      const count = Math.ceil(r * Math.max(maxCount, 1));
                      return (
                        <div
                          key={r}
                          className="w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor:
                              r === 0
                                ? 'var(--timeline-empty)'
                                : cellBg(count, Math.max(maxCount, 1)),
                          }}
                        />
                      );
                    })}
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500">More</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={NO_DATA_STYLE} />
                  <span className="text-xs text-slate-400 dark:text-slate-500">No data</span>
                </div>
                <span className="text-xs text-slate-300 dark:text-slate-600">
                  · Each cell = one calendar day · Click to filter the homepage to that day
                </span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
