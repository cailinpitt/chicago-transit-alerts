import { useEffect, useMemo, useRef, useState } from 'react';
import ActiveAlerts from './components/ActiveAlerts.jsx';
import Filters from './components/Filters.jsx';
import Footer from './components/Footer.jsx';
import Header from './components/Header.jsx';
import HourOfWeekHeatmap from './components/HourOfWeekHeatmap.jsx';
import IncidentList from './components/IncidentList.jsx';
import SignalBreakdown from './components/SignalBreakdown.jsx';
import SummaryStats from './components/SummaryStats.jsx';
import Timeline from './components/Timeline.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useNow } from './hooks/useNow.js';
import {
  buildTodaySummary,
  computeSummaryStats,
  computeTypicalDurations,
} from './lib/aggregate.js';
import {
  filterIncidents,
  getEventId,
  normalizeAlertsPayload,
  observationSignals,
} from './lib/incidents.js';
import { buildStationIndex } from './lib/stations.js';
import {
  buildSearch,
  parseUrlState,
  readStoredFilters,
  writeStoredFilters,
} from './lib/urlState.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Sort routes by leading numeric component, falling back to alpha for
// letter-prefixed variants ('X9', 'J14', '8A'). The previous `+a - +b` sort
// produced `NaN` comparisons for any route that didn't parse as a pure integer,
// scattering them randomly through the list.
function busRouteCompare(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb || a.localeCompare(b);
}

export default function App() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Initial state precedence: URL > localStorage > defaults. The URL wins so
  // shareable links always render the same view. localStorage only fills in
  // when the URL is bare (the common case of a returning visitor opening "/")
  // — picks up their last line/bus/signal selections from the prior session.
  const initial = useMemo(() => {
    const fromUrl = parseUrlState();
    const hasAnyUrl = window.location.search.length > 1;
    if (hasAnyUrl) return fromUrl;
    const stored = readStoredFilters();
    if (!stored) return fromUrl;
    return { ...fromUrl, ...stored };
  }, []);
  const [selectedLines, setSelectedLines] = useState(initial.selectedLines); // null = all lines; [] = no lines
  const [showBus, setShowBus] = useState(initial.showBus);
  const [selectedBusRoutes, setSelectedBusRoutes] = useState(initial.selectedBusRoutes);
  const [dateRange, setDateRange] = useState(initial.dateRange); // days; null = all time
  // selectedDay is a Chicago-day UTC midnight epoch, or null. When set it
  // overrides dateRange for the incident list — the user is drilled into a
  // single day from the timeline.
  const [selectedDay, setSelectedDay] = useState(initial.selectedDay);
  const [selectedSignals, setSelectedSignals] = useState(initial.selectedSignals);
  const [search, setSearch] = useState(initial.search);
  const [activeOnly, setActiveOnly] = useState(initial.activeOnly ?? false);

  function resetFilters() {
    setSelectedLines(null);
    setShowBus(true);
    setSelectedBusRoutes([]);
    setDateRange(7);
    setSelectedDay(null);
    setSelectedSignals([]);
    setSearch('');
    setActiveOnly(false);
  }

  // Picking any range pill drops the day pin — the two are mutually exclusive
  // narrow modes, and a stale pin would silently override the user's choice.
  // Same goes for active-only: the date pills are about historical scope, the
  // active chip is about state, so they overwrite each other rather than
  // compose into "active in last 7 days" (which would always equal active).
  function handleDateRangeChange(next) {
    setDateRange(next);
    setSelectedDay(null);
    setActiveOnly(false);
  }

  function handleActiveOnly(next) {
    setActiveOnly(next);
    if (next) setSelectedDay(null);
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
    const queryString = buildSearch({
      selectedLines,
      showBus,
      selectedBusRoutes,
      dateRange,
      selectedDay,
      selectedSignals,
      search,
      activeOnly,
    });
    const next = `${window.location.pathname}${queryString}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', next);
    }
  }, [
    selectedLines,
    showBus,
    selectedBusRoutes,
    dateRange,
    selectedDay,
    selectedSignals,
    search,
    activeOnly,
  ]);

  // Persist the sticky subset (lines, bus visibility, bus routes, signals)
  // to localStorage so a returning visitor sees the same scope they last
  // chose. dateRange / day pin / search are deliberately excluded — those
  // are momentary, not preferences.
  useEffect(() => {
    writeStoredFilters({ selectedLines, showBus, selectedBusRoutes, selectedSignals });
  }, [selectedLines, showBus, selectedBusRoutes, selectedSignals]);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;

    function fetchData() {
      fetch(url, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((raw) => {
          const fresh = normalizeAlertsPayload(raw);
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

  // Track which event ids have been seen on prior renders, so when the 5-min
  // poll brings in new ones we can briefly highlight them. The first data load
  // seeds the set without highlighting anything — otherwise every event would
  // flash on initial page render.
  const seenIdsRef = useRef(null);
  const [highlightedIds, setHighlightedIds] = useState(() => new Set());
  useEffect(() => {
    if (!data) return;
    const current = new Set();
    for (const a of data.alerts) {
      const id = getEventId(a);
      if (id) current.add(id);
    }
    for (const o of data.observations) {
      const id = getEventId(o);
      if (id) current.add(id);
    }
    if (seenIdsRef.current === null) {
      seenIdsRef.current = current;
      return;
    }
    const fresh = new Set();
    for (const id of current) {
      if (!seenIdsRef.current.has(id)) fresh.add(id);
    }
    seenIdsRef.current = current;
    if (fresh.size === 0) return;
    setHighlightedIds(fresh);
    // Match the keyframe duration in tailwind.config.js — keep the React
    // state alive long enough for the CSS animation to run, then drop the
    // class so it doesn't replay if the component re-renders.
    const t = setTimeout(() => setHighlightedIds(new Set()), 5000);
    return () => clearTimeout(t);
  }, [data]);

  const availableBusRoutes = useMemo(() => {
    if (!data) return [];
    const routes = new Set([
      ...data.observations.filter((o) => o.kind === 'bus').map((o) => o.line),
      ...data.alerts.filter((a) => a.kind === 'bus').flatMap((a) => a.routes),
    ]);
    return [...routes].sort(busRouteCompare);
  }, [data]);

  // Prune any selected bus routes that don't exist in the current data —
  // typically from a stale shareable URL (?routes=66,99 where 99 no longer
  // appears). Without this the bus-route filter silently filters everything
  // out and the user just sees an empty list.
  useEffect(() => {
    if (!data || selectedBusRoutes.length === 0) return;
    const available = new Set(availableBusRoutes);
    const valid = selectedBusRoutes.filter((r) => available.has(r));
    if (valid.length !== selectedBusRoutes.length) setSelectedBusRoutes(valid);
  }, [data, availableBusRoutes, selectedBusRoutes]);

  // Visualization data — `data` minus standalone CTA alerts that the signal
  // filter would drop, plus observations restricted to those carrying any of
  // the selected signal kinds. Used for the Timeline grid and the hour-of-
  // week heatmap so the signal chips actually narrow what those views show.
  // Other filters (lines, range, day pin, bus routes) intentionally aren't
  // applied here — the timeline has its own row-level filtering and dimming
  // for those.
  const vizAlerts = useMemo(() => {
    if (!data) return [];
    if (selectedSignals.length === 0) return data.alerts;
    return [];
  }, [data, selectedSignals]);

  const vizObservations = useMemo(() => {
    if (!data) return [];
    if (selectedSignals.length === 0) return data.observations;
    const sigSet = new Set(selectedSignals);
    return data.observations.filter((o) => observationSignals(o).some((s) => sigSet.has(s)));
  }, [data, selectedSignals]);

  const summaryStats = useMemo(() => {
    if (!data) return null;
    return computeSummaryStats(data.alerts, data.observations, now);
  }, [data, now]);

  const todaySummary = useMemo(() => {
    if (!data) return null;
    return buildTodaySummary(data.alerts, data.observations, now);
  }, [data, now]);

  // 90-day typical-duration cohort lookup, used by ActiveAlerts to surface
  // a "typically ~Xm" hint next to elapsed time on each active card.
  const typicalDurations = useMemo(() => {
    if (!data) return null;
    return computeTypicalDurations(data.alerts, data.observations, { now, windowDays: 90 });
  }, [data, now]);

  // Station index — used by IncidentList to turn station names into
  // /station/:slug links when the destination page is worth visiting.
  const stationIndex = useMemo(() => {
    if (!data) return null;
    return buildStationIndex(data.alerts, data.observations, { now, windowDays: 90 });
  }, [data, now]);

  const filtered = useMemo(() => {
    if (!data) return { alerts: [], observations: [] };
    // activeOnly takes precedence over dateRange — when active-only is on we
    // don't want a stale 7d window silently dropping a 10-day-old ongoing
    // incident from the list.
    const startTs = activeOnly ? null : dateRange ? now - dateRange * DAY_MS : null;
    return filterIncidents(data.alerts, data.observations, {
      lines: selectedLines,
      startTs,
      showBus,
      busRoutes: selectedBusRoutes.length > 0 ? selectedBusRoutes : null,
      selectedDay: activeOnly ? null : selectedDay,
      signals: selectedSignals.length > 0 ? selectedSignals : null,
      search,
      activeOnly,
      now,
    });
  }, [
    data,
    selectedLines,
    showBus,
    selectedBusRoutes,
    dateRange,
    selectedDay,
    selectedSignals,
    search,
    activeOnly,
    now,
  ]);

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
        alerts={data?.alerts}
        observations={data?.observations}
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
            {activeIncidents.length > 0 && (
              <ActiveAlerts
                incidents={activeIncidents}
                now={now}
                highlightedIds={highlightedIds}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
              />
            )}
            {/* Sticky filter bar — keeps controls reachable as the user
                scrolls through the list and visualizations below. The
                negative horizontal margin extends the backdrop past the
                main element's px-4 so scrolled content doesn't peek
                through the gutters. */}
            <div className="sticky top-0 z-30 -mx-4 px-4 py-3 bg-slate-50/95 dark:bg-gh-canvas/95 backdrop-blur-sm border-b border-slate-200 dark:border-gh-border">
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
                selectedSignals={selectedSignals}
                onSignalsChange={setSelectedSignals}
                activeOnly={activeOnly}
                onActiveOnlyChange={handleActiveOnly}
              />
            </div>
            {todaySummary && (
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 px-1">
                {todaySummary}
              </p>
            )}
            {summaryStats && (
              <SummaryStats
                {...summaryStats}
                alerts={data.alerts}
                observations={data.observations}
              />
            )}
            {/* IncidentList sits directly below the summary so picking a
                filter immediately changes what's visible without a long
                scroll past the visualizations. */}
            <IncidentList
              alerts={filtered.alerts}
              observations={filtered.observations}
              search={search}
              onSearchChange={setSearch}
              highlightedIds={highlightedIds}
              stationIndex={stationIndex}
            />
            <Timeline
              alerts={vizAlerts}
              observations={vizObservations}
              selectedLines={selectedLines}
              numDays={90}
              selectedRangeDays={dateRange}
              dataStartTs={data.data_start_ts ?? null}
              now={now}
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
            <HourOfWeekHeatmap alerts={vizAlerts} observations={vizObservations} />
            <SignalBreakdown observations={data.observations} />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
