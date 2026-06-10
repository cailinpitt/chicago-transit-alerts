import { useEffect, useMemo, useRef, useState } from 'react';
import ActiveAlerts from './components/ActiveAlerts.jsx';
import CollapsibleSection from './components/CollapsibleSection.jsx';
import Footer from './components/Footer.jsx';
import Header from './components/Header.jsx';
import HomeFilters from './components/HomeFilters.jsx';
import HourOfWeekHeatmap from './components/HourOfWeekHeatmap.jsx';
import IncidentList from './components/IncidentList.jsx';
import { LONG_RUNNING_THRESHOLD_MS } from './components/LongRunningBanner.jsx';
import RecentActivityGantt from './components/RecentActivityGantt.jsx';
import SignalBreakdown from './components/SignalBreakdown.jsx';
import SummaryStats from './components/SummaryStats.jsx';
import Timeline from './components/Timeline.jsx';
import { useDarkMode } from './hooks/useDarkMode.js';
import { useNow } from './hooks/useNow.js';
import {
  buildTodaySummary,
  computeRecentBurst,
  computeSummaryStats,
  computeTypicalDurations,
} from './lib/aggregate.js';
import { compareBusRoutes } from './lib/busRoutes.js';
import { dataUrl } from './lib/dataSource.js';
import {
  filterIncidents,
  flattenIncidents,
  observationSignals,
  SOURCE_TYPES,
} from './lib/incidents.js';
import { gateIncidents, metraEnabled } from './lib/metraGate.js';
import { buildStationIndex } from './lib/stations.js';
import {
  buildSearch,
  parseUrlState,
  readStoredFilters,
  writeStoredFilters,
} from './lib/urlState.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Migration: a legacy localStorage payload from before the source-filter
    // flip carries `selectedSources: []`, which under the new "selected =
    // shown" semantics would render an empty page. Drop the empty value so
    // the URL/state default (all sources) takes over for that visitor.
    if (Array.isArray(stored.selectedSources) && stored.selectedSources.length === 0) {
      const { selectedSources: _drop, ...rest } = stored;
      return { ...fromUrl, ...rest };
    }
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
  const [selectedSources, setSelectedSources] = useState(initial.selectedSources);
  const [search, setSearch] = useState(initial.search);
  // Agency scope for the ?metra=1 preview: 'all' | 'cta' | 'metra'. Only shown
  // when Metra is enabled; default 'all'.
  const metraOn = useMemo(() => metraEnabled(), []);
  const [selectedAgency, setSelectedAgency] = useState('all');

  function resetFilters() {
    setSelectedLines(null);
    setShowBus(true);
    setSelectedBusRoutes([]);
    setDateRange(7);
    setSelectedDay(null);
    setSelectedSignals([]);
    setSelectedSources([...SOURCE_TYPES]);
    setSearch('');
    setSelectedAgency('all');
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
    const queryString = buildSearch({
      selectedLines,
      showBus,
      selectedBusRoutes,
      dateRange,
      selectedDay,
      selectedSignals,
      selectedSources,
      search,
    });
    // Preserve the Metra preview param across filter changes — buildSearch only
    // emits known filter keys, so without this ?metra=1 would be dropped on the
    // first interaction and Metra would vanish mid-session.
    let withMetra = queryString;
    if (metraEnabled()) {
      const sp = new URLSearchParams(queryString.replace(/^\?/, ''));
      sp.set('metra', '1');
      withMetra = `?${sp.toString()}`;
    }
    const next = `${window.location.pathname}${withMetra}${window.location.hash}`;
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
    selectedSources,
    search,
  ]);

  // Persist the sticky subset (lines, bus visibility, bus routes, signals)
  // to localStorage so a returning visitor sees the same scope they last
  // chose. dateRange / day pin / search are deliberately excluded — those
  // are momentary, not preferences.
  useEffect(() => {
    writeStoredFilters({
      selectedLines,
      showBus,
      selectedBusRoutes,
      selectedSignals,
      selectedSources,
    });
  }, [selectedLines, showBus, selectedBusRoutes, selectedSignals, selectedSources]);

  useEffect(() => {
    const url = dataUrl('alerts.json');

    function fetchData() {
      fetch(url, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((fresh) => {
          // Gate Metra out of the payload at the single load boundary, so no
          // downstream view sees kind='metra' unless ?metra=1 is set. Default
          // (CTA-only) keeps the live site unchanged while Metra ships in the data.
          const gated = { ...fresh, incidents: gateIncidents(fresh.incidents) };
          setData((prev) => {
            // Only update if generated_at changed (or on first load).
            if (!prev || gated.generated_at !== prev.generated_at) return gated;
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

  // Flat { alerts, observations } view of the payload — the analytics layer
  // (summary stats, station index, timeline, ActiveAlerts/Gantt) still reads
  // the flat shape. The incident list path reads the nested `data.incidents`.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  const activeIncidents = useMemo(() => {
    if (!data) return [];
    // Each incident is already unified server-side, so the active set is just
    // the open incidents — no client-side merge needed.
    return data.incidents
      .filter((inc) => inc.active)
      .sort((a, b) => b.first_seen_ts - a.first_seen_ts);
  }, [data]);

  // Split active incidents on the 24h elapsed mark. Long-runners (planned
  // reroutes, multi-day construction) get their own quieter banner — left
  // mixed with the breaking-news cards they trained users to ignore the
  // red treatment after a day or two.
  const { recentActive, longRunningActive } = useMemo(() => {
    const recent = [];
    const longRunning = [];
    for (const i of activeIncidents) {
      const startTs = i.first_seen_ts ?? i.ts;
      if (startTs != null && now - startTs >= LONG_RUNNING_THRESHOLD_MS) longRunning.push(i);
      else recent.push(i);
    }
    return { recentActive: recent, longRunningActive: longRunning };
  }, [activeIncidents, now]);

  // Surface the active count in the tab title so a pinned tab tells the user
  // something is wrong without them having to switch to it.
  useEffect(() => {
    const base = 'Chicago Transit Alerts';
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
    for (const inc of data.incidents) {
      if (inc.id) current.add(inc.id);
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
    if (!flat) return [];
    const routes = new Set([
      ...flat.observations.filter((o) => o.kind === 'bus').map((o) => o.line),
      ...flat.alerts.filter((a) => a.kind === 'bus').flatMap((a) => a.routes),
    ]);
    return [...routes].sort(compareBusRoutes);
  }, [flat]);

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
    if (!flat) return [];
    if (selectedSignals.length === 0) return flat.alerts;
    return [];
  }, [flat, selectedSignals]);

  const vizObservations = useMemo(() => {
    if (!flat) return [];
    if (selectedSignals.length === 0) return flat.observations;
    const sigSet = new Set(selectedSignals);
    return flat.observations.filter((o) => observationSignals(o).some((s) => sigSet.has(s)));
  }, [flat, selectedSignals]);

  const summaryStats = useMemo(() => {
    if (!flat) return null;
    return computeSummaryStats(flat.alerts, flat.observations, now);
  }, [flat, now]);

  const todaySummary = useMemo(() => {
    if (!flat) return null;
    return buildTodaySummary(flat.alerts, flat.observations, now);
  }, [flat, now]);

  // 90-day typical-duration cohort lookup, used by ActiveAlerts to surface
  // a "typically ~Xm" hint next to elapsed time on each active card.
  const typicalDurations = useMemo(() => {
    if (!flat) return null;
    return computeTypicalDurations(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [flat, now]);

  // System-wide burst detector: incidents in the last 3h vs. the 30d baseline
  // rate, scaled to the same 3h window. Used by ActiveAlerts to flash a
  // "Z× typical rate" chip only when things are visibly worse than usual.
  const burst = useMemo(() => {
    if (!flat) return null;
    return computeRecentBurst(flat.alerts, flat.observations, {
      now,
      windowHours: 3,
      baselineDays: 30,
    });
  }, [flat, now]);

  // Station index — used by IncidentList to turn station names into
  // /station/:slug links when the destination page is worth visiting.
  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [flat, now]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const startTs = dateRange ? now - dateRange * DAY_MS : null;
    return filterIncidents(data.incidents, {
      lines: selectedLines,
      startTs,
      showBus,
      busRoutes: selectedBusRoutes.length > 0 ? selectedBusRoutes : null,
      selectedDay,
      signals: selectedSignals.length > 0 ? selectedSignals : null,
      // Only narrow when the user picked a subset; default (all three) ⇒
      // pass null so the source filter is skipped.
      sources: selectedSources.length < SOURCE_TYPES.length ? selectedSources : null,
      search,
      agencies: selectedAgency === 'all' ? null : [selectedAgency],
      now,
    });
  }, [
    data,
    selectedLines,
    showBus,
    selectedBusRoutes,
    selectedAgency,
    dateRange,
    selectedDay,
    selectedSignals,
    selectedSources,
    search,
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
        alerts={flat?.alerts}
        observations={flat?.observations}
      />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
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
            {/* Status, top of page: live alerts when something's active, or a
                friendly all-clear banner on a quiet day — so a first-time
                visitor always lands on a clear answer to "is anything wrong
                right now?" rather than a filter bar. */}
            {recentActive.length > 0 || longRunningActive.length > 0 ? (
              <ActiveAlerts
                incidents={recentActive}
                longRunningIncidents={longRunningActive}
                now={now}
                highlightedIds={highlightedIds}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
                burst={burst}
              />
            ) : (
              <section className="flex items-center gap-3 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-green-500"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                    All clear
                  </p>
                  <p className="text-xs text-green-700/80 dark:text-green-400/80">
                    No active CTA disruptions right now.
                  </p>
                </div>
              </section>
            )}

            {/* Overview: today's narrative plus the headline stats, grouped
                into one block instead of two stacked text rows. */}
            {(todaySummary || summaryStats) && (
              <section className="space-y-3">
                {todaySummary && (
                  <div className="px-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      🗓️ {todaySummary.text}
                      {todaySummary.lastWeek && (
                        <>
                          {' · '}
                          {todaySummary.lastWeek.count} last{' '}
                          <a
                            href={`/day/${todaySummary.lastWeek.iso}/`}
                            className="text-blue-500 hover:text-blue-400 hover:underline"
                          >
                            {todaySummary.lastWeek.label}
                          </a>
                        </>
                      )}
                      .
                    </p>
                    {todaySummary.lastWeek && (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Counts incidents that started each day; a day page can show more, since it
                        also includes ones still ongoing from earlier.
                      </p>
                    )}
                  </div>
                )}
                {summaryStats && (
                  <SummaryStats
                    {...summaryStats}
                    alerts={flat.alerts}
                    observations={flat.observations}
                    showActive={false}
                  />
                )}
              </section>
            )}

            {/* Incident list with its filter controls attached directly
                above it (the thing they narrow), collapsed by default. The
                sticky wrapper keeps the Filters trigger reachable while
                scrolling the list; the negative margin extends the backdrop
                past the main element's px-4 gutters. */}
            <section className="space-y-3">
              <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-slate-50/95 dark:bg-gh-canvas/95 backdrop-blur-sm">
                {metraOn && (
                  <div
                    className="mb-2 inline-flex rounded-lg border border-slate-300 dark:border-gh-border overflow-hidden text-xs font-semibold"
                    role="group"
                    aria-label="Agency"
                  >
                    {[
                      ['all', 'All'],
                      ['cta', 'CTA'],
                      ['metra', 'Metra'],
                    ].map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        onClick={() => setSelectedAgency(value)}
                        className={`px-3 py-1 transition-colors ${
                          selectedAgency === value
                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                            : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gh-border/40'
                        }`}
                        aria-pressed={selectedAgency === value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <HomeFilters
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
                  selectedSources={selectedSources}
                  onSourcesChange={setSelectedSources}
                  onResetFilters={resetFilters}
                />
              </div>
              <IncidentList
                incidents={filtered}
                search={search}
                onSearchChange={setSearch}
                highlightedIds={highlightedIds}
                stationIndex={stationIndex}
                isFiltered={
                  selectedLines !== null ||
                  !showBus ||
                  selectedBusRoutes.length > 0 ||
                  dateRange !== 7 ||
                  selectedDay !== null ||
                  selectedSignals.length > 0 ||
                  selectedSources.length < SOURCE_TYPES.length
                }
              />
            </section>

            {/* Retrospective analytics, collapsed by default so the homepage
                opens on "now" instead of a wall of charts. Everything here is
                exploratory history a casual/mobile visitor rarely needs up
                front; one tap expands it. */}
            <CollapsibleSection
              title="Trends & history"
              subtitle="Last 24h · 90-day timeline · patterns"
              className="pt-4 mt-2 border-t border-slate-200 dark:border-gh-border"
            >
              <RecentActivityGantt incidents={data.incidents} now={now} />
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
              <SignalBreakdown observations={flat.observations} />
            </CollapsibleSection>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
