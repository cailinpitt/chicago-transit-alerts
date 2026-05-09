import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  computeDurationHistogram,
  computeLineReliability,
  computeSummaryStats,
  computeTypicalDurations,
  computeYearOverYear,
} from '../lib/aggregate.js';
import { BUS_ROUTE_NAMES, formatBusRoute } from '../lib/busRoutes.js';
import { normalizeTrainLine, TRAIN_LINES } from '../lib/ctaLines.js';
import { formatGap } from '../lib/format.js';
import { normalizeAlertsPayload, searchFilterIncidents } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import ActiveAlerts from './ActiveAlerts.jsx';
import Header from './Header.jsx';
import HourOfWeekHeatmap from './HourOfWeekHeatmap.jsx';
import IncidentList from './IncidentList.jsx';
import LineMap from './LineMap.jsx';
import { SignalBreakdownSingleRoute } from './SignalBreakdown.jsx';
import Timeline from './Timeline.jsx';
import TrendSparkline from './TrendSparkline.jsx';

// Distribution of resolution times for this line over the rolling window.
// Compact horizontal bars — each row is a duration bin. Hidden when the
// cohort is empty (no resolved incidents on this line yet) so a brand-new
// line page doesn't have a "0 / 0 / 0 / 0" stub.
function DurationHistogram({ histogram }) {
  if (!histogram || histogram.total === 0) return null;
  const max = histogram.bins.reduce((m, b) => (b.count > m ? b.count : m), 0);
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Resolution time (last 90 days)
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="space-y-1.5">
          {histogram.bins.map((b) => {
            const pct = max > 0 ? (b.count / max) * 100 : 0;
            return (
              <div key={b.label} className="flex items-center gap-3">
                <div className="w-16 flex-shrink-0 text-right">
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {b.label}
                  </span>
                </div>
                <div className="flex-1 h-4 rounded-sm bg-slate-100 dark:bg-gh-subtle overflow-hidden">
                  {b.count > 0 && (
                    <div
                      className="h-full bg-slate-500 dark:bg-slate-400"
                      style={{ width: `${pct}%` }}
                      role="img"
                      aria-label={`${b.label}: ${b.count} incident${b.count === 1 ? '' : 's'}`}
                    />
                  )}
                </div>
                <div className="w-8 text-right flex-shrink-0">
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {b.count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
          {histogram.total} resolved incident{histogram.total === 1 ? '' : 's'} · active incidents
          excluded (no final duration yet)
        </p>
      </div>
    </section>
  );
}

// LinePage — `/line/:id` for trains, `/route/:id` for buses. Renders the
// same data-rich blocks as the homepage but pre-filtered to a single line
// or bus route, with a permalink-friendly URL. Reuses existing components
// by feeding them only the matching subset of alerts/observations; the
// components don't need to know they're scoped.
export default function LinePage({ kind, lineId }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Validate the id: for trains it must be a known TRAIN_LINES key (after
  // normalizing CTA short codes — `/line/org` resolves to 'orange'); for
  // buses it must appear in BUS_ROUTE_NAMES (which is comprehensive). An
  // unknown id renders the not-found card without trying to fetch.
  const isTrain = kind === 'train';
  const normalizedLineId = isTrain ? normalizeTrainLine(lineId) : lineId;
  const trainInfo = isTrain ? TRAIN_LINES[normalizedLineId] : null;
  const busName = !isTrain ? BUS_ROUTE_NAMES[lineId] : null;
  const isKnown = isTrain ? !!trainInfo : !!busName;
  // Use the normalized id for all internal lookups so a `/line/org` URL
  // matches data tagged 'orange' after `normalizeAlertsPayload` runs.
  const effectiveLineId = isTrain ? normalizedLineId : lineId;

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => setData(normalizeAlertsPayload(raw)))
      .catch(setError);
  }, []);

  // Subset of the dataset that touches this line/route. Trains carry the
  // line on `routes` (alerts) or `line` (observations); buses carry the
  // route number in the same fields. We use this subset for every
  // visualization so each card reflects only this one line's behavior.
  const lineAlerts = useMemo(() => {
    if (!data) return [];
    return data.alerts.filter(
      (a) => a.kind === kind && Array.isArray(a.routes) && a.routes.includes(effectiveLineId),
    );
  }, [data, kind, effectiveLineId]);

  const lineObservations = useMemo(() => {
    if (!data) return [];
    return data.observations.filter((o) => o.kind === kind && o.line === effectiveLineId);
  }, [data, kind, effectiveLineId]);

  const activeIncidents = useMemo(() => {
    return [
      ...lineAlerts.filter((a) => a.active),
      ...lineObservations.filter((o) => o.active),
    ].sort((a, b) => (b.first_seen_ts || b.ts) - (a.first_seen_ts || a.ts));
  }, [lineAlerts, lineObservations]);

  // Title + tab title — built from the human label, not the key. The bus
  // chip uses the bare route number ("#147") so it stays compact and
  // parallel with the train pill ("Red Line"); the route name is rendered
  // separately to the right rather than crammed inside the pill.
  const heading = isTrain ? `${trainInfo?.label ?? lineId} Line` : `#${lineId}`;
  // The tab title uses the longer formatBusRoute form so a pinned tab is
  // unambiguous in the OS tab strip ("#147 Outer DuSable Lake Shore Exp.").
  const tabHeading = isTrain ? heading : busName ? formatBusRoute(lineId) : lineId;
  useEffect(() => {
    const base = 'CTA Alert History';
    if (!isKnown) {
      document.title = `${base}`;
      return;
    }
    const prefix = activeIncidents.length > 0 ? `(${activeIncidents.length}) ` : '';
    document.title = `${prefix}${tabHeading} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [isKnown, tabHeading, activeIncidents.length]);

  // Per-line summary: reuse computeSummaryStats with only this line's data.
  // The "most affected" answer collapses to either this line/route or null
  // (no incidents in 30d), so we don't render that field separately —
  // weeklyCount and the trend sparkline carry the load.
  const summary = useMemo(() => {
    if (!data) return null;
    return computeSummaryStats(lineAlerts, lineObservations, now);
  }, [data, lineAlerts, lineObservations, now]);

  // 90-day reliability snapshot for this line: how many days were quiet, and
  // the typical cadence between incidents. Hidden when there's no incident
  // history — "0 of 90 days" reads worse than just not showing the line.
  const reliability = useMemo(() => {
    if (!data) return null;
    return computeLineReliability(lineAlerts, lineObservations, { now, windowDays: 90 });
  }, [data, lineAlerts, lineObservations, now]);

  const typicalDurations = useMemo(() => {
    if (!data) return null;
    return computeTypicalDurations(lineAlerts, lineObservations, { now, windowDays: 90 });
  }, [data, lineAlerts, lineObservations, now]);

  const durationHistogram = useMemo(() => {
    if (!data) return null;
    return computeDurationHistogram(lineAlerts, lineObservations, { now, windowDays: 90 });
  }, [data, lineAlerts, lineObservations, now]);

  // YoY for this line specifically. Gated on data_start_ts covering the
  // prior window — for a young dataset this just renders nothing rather
  // than a misleading "0 vs 0".
  const yoy = useMemo(() => {
    if (!data) return null;
    return computeYearOverYear(lineAlerts, lineObservations, {
      now,
      windowDays: 30,
      dataStartTs: data.data_start_ts ?? null,
    });
  }, [data, lineAlerts, lineObservations, now]);

  // Station index built from the full dataset, not just this line. A station
  // can appear on multiple lines (Howard is on Red + Yellow; Damen on Blue +
  // Brown), and clicking it should land on the cross-line station page —
  // not be gated on whether this particular line meets the threshold.
  const stationIndex = useMemo(() => {
    if (!data) return null;
    return buildStationIndex(data.alerts, data.observations, { now, windowDays: 90 });
  }, [data, now]);

  // Search-only narrowing for the IncidentList. The line is already locked
  // by the pre-filter above; only free-text search remains. Reuse the same
  // matchers `filterIncidents` uses so search behavior stays in one place.
  const listFiltered = useMemo(
    () => searchFilterIncidents(lineAlerts, lineObservations, search),
    [lineAlerts, lineObservations, search],
  );

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  if (!isKnown) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
        <Header
          generatedAt={data?.generated_at}
          dark={dark}
          onToggleDark={toggleDark}
          onResetFilters={() => {
            window.location.href = '/';
          }}
          alerts={data?.alerts}
          observations={data?.observations}
        />
        <main className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
          <a href="/" className="text-sm text-blue-500 hover:text-blue-400 hover:underline">
            ← Back to all incidents
          </a>
          <div className="mt-4 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              We don't recognize {kind === 'train' ? 'that line' : 'that route'} ({lineId}).
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Color used for the heading pill + accents. Trains use their CTA brand
  // color; buses fall back to slate to match the bus rows in the timeline.
  const headingBg = isTrain ? trainInfo.color : '#64748b';
  const headingText = isTrain ? trainInfo.textColor : '#fff';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={data?.alerts}
        observations={data?.observations}
      />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        <div>
          <a
            href="/"
            className="text-sm text-blue-500 hover:text-blue-400 hover:underline inline-block mb-3"
          >
            ← Back to all incidents
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
              style={{ backgroundColor: headingBg, color: headingText }}
            >
              {heading}
            </span>
            {!isTrain && busName && (
              <span className="text-sm text-slate-500 dark:text-slate-400">{busName}</span>
            )}
          </div>
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {data && (
          <>
            {activeIncidents.length > 0 && (
              <ActiveAlerts
                incidents={activeIncidents}
                now={now}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
              />
            )}

            {summary && (summary.weeklyCount > 0 || summary.quietestLineDays > 0) && (
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-1">
                <div className="space-y-1">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    <strong className="text-slate-800 dark:text-slate-100">
                      {summary.weeklyCount}
                    </strong>{' '}
                    incident{summary.weeklyCount === 1 ? '' : 's'} in the last 7 days
                    {summary.quietestLineDays >= 2 && (
                      <>
                        <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                        <span>{summary.quietestLineDays} days since last incident</span>
                      </>
                    )}
                  </p>
                  {reliability && reliability.incidentFreeDays < reliability.totalDays && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <strong className="text-slate-700 dark:text-slate-200">
                        {reliability.incidentFreeDays} of {reliability.totalDays} days
                      </strong>{' '}
                      incident-free (90d)
                      {reliability.longestStreakDays >= 2 && (
                        <>
                          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                          <span>
                            longest streak{' '}
                            <strong className="text-slate-700 dark:text-slate-200">
                              {reliability.longestStreakDays} day
                              {reliability.longestStreakDays === 1 ? '' : 's'}
                            </strong>
                          </span>
                        </>
                      )}
                      {reliability.medianGapHours != null && (
                        <>
                          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                          <span>
                            median{' '}
                            <strong className="text-slate-700 dark:text-slate-200">
                              {formatGap(reliability.medianGapHours)}
                            </strong>{' '}
                            between incidents
                          </span>
                        </>
                      )}
                    </p>
                  )}
                  {yoy?.enoughData && yoy.pctChange != null && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <strong
                        className={
                          yoy.pctChange > 0
                            ? 'text-red-500'
                            : yoy.pctChange < 0
                              ? 'text-green-600 dark:text-green-500'
                              : 'text-slate-700 dark:text-slate-200'
                        }
                      >
                        {yoy.pctChange === 0
                          ? 'Unchanged'
                          : `${Math.abs(Math.round(yoy.pctChange * 100))}% ${yoy.pctChange > 0 ? 'busier' : 'quieter'}`}
                      </strong>{' '}
                      than the same 30 days a year ago ({yoy.priorCount} → {yoy.currentCount})
                    </p>
                  )}
                </div>
                <TrendSparkline alerts={lineAlerts} observations={lineObservations} />
              </div>
            )}

            {/* Geographic station heatmap — train-only, since the data
                files cover the L. Hidden on bus pages. */}
            {isTrain && <LineMap lineKey={effectiveLineId} stationIndex={stationIndex} />}

            <DurationHistogram histogram={durationHistogram} />

            <Timeline
              alerts={lineAlerts}
              observations={lineObservations}
              selectedLines={isTrain ? [effectiveLineId] : []}
              numDays={90}
              selectedRangeDays={null}
              dataStartTs={data.data_start_ts ?? null}
              now={now}
              onLineClick={() => {}}
              showBus={!isTrain}
              selectedBusRoutes={!isTrain ? [lineId] : []}
              onBusRouteClick={() => {}}
            />

            <HourOfWeekHeatmap alerts={lineAlerts} observations={lineObservations} />

            {!isTrain && (
              <SignalBreakdownSingleRoute
                observations={lineObservations}
                label={`#${lineId}`}
                labelColor={headingBg}
              />
            )}

            <IncidentList
              alerts={listFiltered.alerts}
              observations={listFiltered.observations}
              search={search}
              onSearchChange={setSearch}
              stationIndex={stationIndex}
            />
          </>
        )}

        {data && lineAlerts.length === 0 && lineObservations.length === 0 && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
            No incidents on record for {heading}.
          </div>
        )}
      </main>
    </div>
  );
}
