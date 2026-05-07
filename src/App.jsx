import { useEffect, useMemo, useState } from 'react';
import ActiveAlerts from './components/ActiveAlerts.jsx';
import Filters from './components/Filters.jsx';
import Footer from './components/Footer.jsx';
import Header from './components/Header.jsx';
import IncidentList from './components/IncidentList.jsx';
import SummaryStats from './components/SummaryStats.jsx';
import Timeline from './components/Timeline.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { computeSummaryStats } from './lib/aggregate.js';
import { filterIncidents } from './lib/incidents.js';
import { buildSearch, parseUrlState } from './lib/urlState.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function App() {
  const [dark, toggleDark] = useDarkMode();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const initial = useMemo(() => parseUrlState(), []);
  const [selectedLines, setSelectedLines] = useState(initial.selectedLines); // null = all lines; [] = no lines
  const [showBus, setShowBus] = useState(initial.showBus);
  const [selectedBusRoutes, setSelectedBusRoutes] = useState(initial.selectedBusRoutes);
  const [dateRange, setDateRange] = useState(initial.dateRange); // days; null = all time
  // selectedDay is a Chicago-day UTC midnight epoch, or null. When set it
  // overrides dateRange for the incident list — the user is drilled into a
  // single day from the timeline.
  const [selectedDay, setSelectedDay] = useState(initial.selectedDay);

  function resetFilters() {
    setSelectedLines(null);
    setShowBus(true);
    setSelectedBusRoutes([]);
    setDateRange(7);
    setSelectedDay(null);
  }

  // Picking any range pill drops the day pin — the two are mutually exclusive
  // narrow modes, and a stale pin would silently override the user's choice.
  function handleDateRangeChange(next) {
    setDateRange(next);
    setSelectedDay(null);
  }

  // Auto-flip bus visibility on transitions in/out of a positive train-line
  // selection. So clicking "Red" hides buses (a Red Line view almost never
  // wants unrelated bus disruptions); clicking it off restores them. The
  // "Buses" button still lets the user override.
  function handleLinesChange(next) {
    const resolved = typeof next === 'function' ? next(selectedLines) : next;
    setSelectedLines(resolved);
    const wasNarrowed = selectedLines !== null && selectedLines.length > 0;
    const willBeNarrowed = resolved !== null && resolved.length > 0;
    if (wasNarrowed !== willBeNarrowed) setShowBus(!willBeNarrowed);
  }

  // Mirror filter state to the URL so views are shareable. replaceState (not
  // pushState) so the back button doesn't traverse every filter toggle.
  useEffect(() => {
    const search = buildSearch({
      selectedLines,
      showBus,
      selectedBusRoutes,
      dateRange,
      selectedDay,
    });
    const next = `${window.location.pathname}${search}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', next);
    }
  }, [selectedLines, showBus, selectedBusRoutes, dateRange, selectedDay]);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;

    function fetchData() {
      fetch(url, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((fresh) => {
          setData((prev) => {
            // Only update if generated_at changed (or on first load).
            if (!prev || fresh.generated_at !== prev.generated_at) return fresh;
            return prev;
          });
        })
        .catch((err) => {
          // Only surface fetch errors on the initial load.
          setData((prev) => {
            if (!prev) setError(err);
            return prev;
          });
        });
    }

    fetchData();
    const id = setInterval(fetchData, 5 * 60 * 1000); // poll every 5 minutes
    return () => clearInterval(id);
  }, []);

  const activeIncidents = useMemo(() => {
    if (!data) return [];
    return [
      ...data.alerts.filter((a) => a.active),
      ...data.observations.filter((o) => o.active),
    ].sort((a, b) => (b.first_seen_ts || b.ts) - (a.first_seen_ts || a.ts));
  }, [data]);

  // Surface the active count in the tab title so a pinned tab tells the user
  // something is wrong without them having to switch to it.
  useEffect(() => {
    const base = 'CTA Alert History';
    document.title = activeIncidents.length > 0 ? `(${activeIncidents.length}) ${base}` : base;
  }, [activeIncidents.length]);

  const availableBusRoutes = useMemo(() => {
    if (!data) return [];
    const routes = new Set([
      ...data.observations.filter((o) => o.kind === 'bus').map((o) => o.line),
      ...data.alerts.filter((a) => a.kind === 'bus').flatMap((a) => a.routes),
    ]);
    return [...routes].sort((a, b) => +a - +b);
  }, [data]);

  const summaryStats = useMemo(() => {
    if (!data) return null;
    return computeSummaryStats(data.alerts, data.observations);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return { alerts: [], observations: [] };
    const startTs = dateRange ? Date.now() - dateRange * DAY_MS : null;
    return filterIncidents(data.alerts, data.observations, {
      lines: selectedLines,
      startTs,
      showBus,
      busRoutes: selectedBusRoutes.length > 0 ? selectedBusRoutes : null,
      selectedDay,
    });
  }, [data, selectedLines, showBus, selectedBusRoutes, dateRange, selectedDay]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={resetFilters}
      />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-10 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-64 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}
        {data && (
          <>
            {activeIncidents.length > 0 && <ActiveAlerts incidents={activeIncidents} />}
            <Filters
              selectedLines={selectedLines}
              onLinesChange={handleLinesChange}
              showBus={showBus}
              onShowBusChange={(val) => {
                setShowBus(val);
                if (!val) setSelectedBusRoutes([]);
              }}
              availableBusRoutes={availableBusRoutes}
              selectedBusRoutes={selectedBusRoutes}
              onBusRoutesChange={setSelectedBusRoutes}
              dateRange={dateRange}
              onDateRangeChange={handleDateRangeChange}
              selectedDay={selectedDay}
              onClearSelectedDay={() => setSelectedDay(null)}
            />
            {summaryStats && <SummaryStats {...summaryStats} />}
            <Timeline
              alerts={data.alerts}
              observations={data.observations}
              selectedLines={selectedLines}
              numDays={90}
              selectedRangeDays={dateRange}
              dataStartTs={data.data_start_ts ?? null}
              onLineClick={(line) =>
                handleLinesChange((prev) =>
                  prev?.includes(line) ? prev.filter((l) => l !== line) : [line],
                )
              }
              selectedDay={selectedDay}
              onDayClick={(dayUtc) => setSelectedDay((prev) => (prev === dayUtc ? null : dayUtc))}
              showBus={showBus}
              selectedBusRoutes={selectedBusRoutes}
              onBusRouteClick={(route) =>
                setSelectedBusRoutes((prev) =>
                  prev.includes(route) ? prev.filter((r) => r !== route) : [...prev, route],
                )
              }
            />
            <IncidentList alerts={filtered.alerts} observations={filtered.observations} />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
