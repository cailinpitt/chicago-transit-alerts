import { Fragment, useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  computeDayOfWeekCounts,
  computeDisruptionMinutes,
  computeDurationHistogram,
  computeLineReliability,
  computeMetraCancellationDelayStats,
  computeRecentBurst,
  computeSegmentRecurrence,
  computeSummaryStats,
  computeTypicalDurations,
  computeWorstDay,
  computeYearOverYear,
} from '../lib/aggregate.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { BUS_ROUTE_NAMES, formatBusRoute } from '../lib/busRoutes.js';
import { cancellationInfo } from '../lib/cancellation.js';
import { normalizeTrainLine, TRAIN_LINES } from '../lib/ctaLines.js';
import { dataUrl } from '../lib/dataSource.js';
import { formatChicagoDay, formatGap, formatMinutesAsHours } from '../lib/format.js';
import {
  incidentLifecycle,
  incidentRecords,
  legacyKind,
  searchFilterIncidents,
} from '../lib/incidents.js';
import { metraLineInfo, normalizeMetraLine } from '../lib/metraLines.js';
import { buildMetraStationIndex } from '../lib/metraStations.js';
import { buildStationIndex } from '../lib/stations.js';
import ActiveAlerts from './ActiveAlerts.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import HourOfWeekHeatmap from './HourOfWeekHeatmap.jsx';
import IncidentList from './IncidentList.jsx';
import LineMap from './LineMap.jsx';
import { LONG_RUNNING_THRESHOLD_MS } from './LongRunningBanner.jsx';
import MetraCancellationDelayStats from './MetraCancellationDelayStats.jsx';
import MetraUpcomingCancellations from './MetraUpcomingCancellations.jsx';
import NotFoundPage from './NotFoundPage.jsx';
import { SignalBreakdownSingleRoute } from './SignalBreakdown.jsx';
import Timeline from './Timeline.jsx';
import TrendSparkline from './TrendSparkline.jsx';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Compact 7-bar weekday breakdown. Average incidents per weekday over the
// rolling window — riders pattern-match commute days ("Fridays are bad")
// faster from this than from the hour-of-week heatmap, which mixes weekday
// and time-of-day into one cell.
function DayOfWeekBars({ data }) {
  if (!data || data.total === 0) return null;
  const { counts, numWeeks, maxCount } = data;
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Incidents by day of week (90d)
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
          {counts.map((count, weekday) => {
            const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
            const perWeek = (count / numWeeks).toFixed(1);
            return (
              <Fragment key={WEEKDAY_LABELS[weekday]}>
                <div className="text-xs text-slate-500 dark:text-slate-400 w-10 text-right tabular-nums">
                  {WEEKDAY_LABELS[weekday]}
                </div>
                <div className="flex items-center">
                  <div className="w-full h-4 rounded-sm bg-slate-100 dark:bg-gh-subtle overflow-hidden">
                    {count > 0 && (
                      <div
                        className="h-full bg-slate-500 dark:bg-slate-400"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                        role="img"
                        aria-label={`${WEEKDAY_LABELS[weekday]}: ${count} incidents over ${numWeeks} weeks (avg ${perWeek}/wk)`}
                      />
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums w-20 text-right">
                  {count} <span className="text-slate-500 dark:text-slate-400">({perWeek}/wk)</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

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
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
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
  const isMetra = kind === 'metra';
  const normalizedLineId = isTrain
    ? normalizeTrainLine(lineId)
    : isMetra
      ? normalizeMetraLine(lineId)
      : lineId;
  const trainInfo = isTrain ? TRAIN_LINES[normalizedLineId] : null;
  const metraInfo = isMetra ? metraLineInfo(lineId) : null;
  const busName = !isTrain && !isMetra ? BUS_ROUTE_NAMES[lineId] : null;
  const isKnown = isTrain ? !!trainInfo : isMetra ? !!metraInfo : !!busName;
  // Use the normalized id for all internal lookups so a `/line/org` URL matches
  // data tagged 'orange', and `/metra/line/up-w` matches data tagged 'up-w'.
  const effectiveLineId = isTrain || isMetra ? normalizedLineId : lineId;
  // Lines treated as rail for display copy ("this line" vs "this route") and for
  // skipping the bus-route-style chrome.
  const isRail = isTrain || isMetra;

  useEffect(() => {
    const url = dataUrl('alerts.json');
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((fresh) => setData({ ...fresh, incidents: fresh.incidents || [] }))
      .catch(setError);
  }, []);

  // Flat view of the full dataset; the analytics cards still read the flat
  // shape. The incident list reads nested incidents (see lineIncidents).
  const flat = useMemo(() => (data ? incidentRecords(data.incidents) : null), [data]);

  // Nested incidents that touch this line/route — used for the list. Trains and
  // buses both carry the line/route key in the incident's top-level `routes`.
  const lineIncidents = useMemo(() => {
    if (!data) return [];
    return data.incidents.filter(
      (inc) =>
        legacyKind(inc) === kind &&
        Array.isArray(inc.routes) &&
        inc.routes.includes(effectiveLineId),
    );
  }, [data, kind, effectiveLineId]);

  // Flat subset of the dataset that touches this line/route, used for every
  // visualization so each card reflects only this one line's behavior.
  const lineAlerts = useMemo(() => {
    if (!flat) return [];
    return flat.officialRecords.filter(
      (a) => a.kind === kind && Array.isArray(a.routes) && a.routes.includes(effectiveLineId),
    );
  }, [flat, kind, effectiveLineId]);

  const lineObservations = useMemo(() => {
    if (!flat) return [];
    return flat.detectionRecords.filter((o) => o.kind === kind && o.line === effectiveLineId);
  }, [flat, kind, effectiveLineId]);

  // Incidents are already unified server-side, so the active set is just the
  // open incidents on this line.
  const activeIncidents = useMemo(
    () =>
      lineIncidents
        .filter((inc) => incidentLifecycle(inc).active)
        .sort((a, b) => incidentLifecycle(b).first_seen_ts - incidentLifecycle(a).first_seen_ts),
    [lineIncidents],
  );

  const { recentActive, longRunningActive } = useMemo(() => {
    const recent = [];
    const longRunning = [];
    for (const i of activeIncidents) {
      // Upcoming single-train cancellations are forward-looking, not live
      // disruptions — they get their own strip, not the "active disruptions"
      // cards (and never the long-running "Day N" framing).
      if (cancellationInfo(i)) continue;
      const startTs = incidentLifecycle(i).first_seen_ts;
      if (startTs != null && now - startTs >= LONG_RUNNING_THRESHOLD_MS) longRunning.push(i);
      else recent.push(i);
    }
    return { recentActive: recent, longRunningActive: longRunning };
  }, [activeIncidents, now]);

  // Title + tab title — built from the human label, not the key. The bus
  // chip uses the bare route number ("#147") so it stays compact and
  // parallel with the train pill ("Red Line"); the route name is rendered
  // separately to the right rather than crammed inside the pill.
  const heading = isTrain
    ? `${trainInfo?.label ?? lineId} Line`
    : isMetra
      ? (metraInfo?.label ?? lineId)
      : `#${lineId}`;
  // The tab title uses the longer formatBusRoute form so a pinned tab is
  // unambiguous in the OS tab strip ("#147 Outer DuSable Lake Shore Exp.").
  const tabHeading = isRail ? heading : busName ? formatBusRoute(lineId) : lineId;
  useEffect(() => {
    const base = 'Chicago Transit Alerts';
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

  // Disruption-hours over the most recent 30 days. Severity-weighted
  // companion to the raw incident count — a 90-minute hold and a 3-minute
  // gap both count as 1 incident, but only the hold lands materially here.
  const disruption = useMemo(() => {
    if (!data) return null;
    return computeDisruptionMinutes(lineAlerts, lineObservations, {
      now,
      windowDays: 30,
      lines: [{ kind, line: effectiveLineId }],
    });
  }, [data, lineAlerts, lineObservations, now, kind, effectiveLineId]);

  // Flurry detector: count recent incident starts and compare to the line's
  // own 30-day baseline. Gating combines an absolute floor (>=3 in window —
  // a Red Line "flurry" of one incident isn't a flurry) and a relative
  // threshold (>=2.5× baseline) so a chronically-busy line doesn't show the
  // chip during normal-for-it activity.
  const burst = useMemo(() => {
    if (!data) return null;
    return computeRecentBurst(lineAlerts, lineObservations, {
      now,
      windowHours: 3,
      baselineDays: 30,
    });
  }, [data, lineAlerts, lineObservations, now]);
  const burstActive =
    burst != null && burst.recentCount >= 3 && burst.ratio != null && burst.ratio >= 2.5;

  const dayOfWeek = useMemo(() => {
    if (!data) return null;
    return computeDayOfWeekCounts(lineAlerts, lineObservations, { now, windowDays: 91 });
  }, [data, lineAlerts, lineObservations, now]);

  // Cancellation + delay analytics for this Metra line — counts (consistent
  // with the rest of the site), per-week rates, recency, the originating-
  // terminal breakdown, and time-of-day. Drives the dedicated section below;
  // Metra only.
  const metraCancelDelay = useMemo(() => {
    if (!data || !isMetra) return null;
    return computeMetraCancellationDelayStats(lineIncidents, {
      now,
      windowDays: 90,
      lineFilter: effectiveLineId,
    });
  }, [data, isMetra, lineIncidents, now, effectiveLineId]);

  // Worst single day for this line/route in the 90d window. Surfaced as a
  // single-line callout linking to the day-permalink — gives a quick "this
  // is the floor we've sunk to" reference point.
  const worstDay = useMemo(() => {
    if (!data) return null;
    return computeWorstDay(lineAlerts, lineObservations, { now, windowDays: 90 });
  }, [data, lineAlerts, lineObservations, now]);

  // Recurring trouble segments scoped to this line. Trains only — buses have
  // far more stops and route variation than the helper's bucketing handles
  // cleanly. Empty array on bus pages.
  const segments = useMemo(() => {
    if (!flat || !isTrain) return [];
    return computeSegmentRecurrence(flat.detectionRecords, {
      now,
      windowDays: 90,
      lineFilter: effectiveLineId,
      limit: 5,
    });
  }, [flat, isTrain, effectiveLineId, now]);

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
    if (!flat) return null;
    return isMetra
      ? buildMetraStationIndex(flat.officialRecords, flat.detectionRecords, { now, windowDays: 90 })
      : buildStationIndex(flat.officialRecords, flat.detectionRecords, { now, windowDays: 90 });
  }, [flat, now, isMetra]);

  // Search-only narrowing for the IncidentList. The line is already locked
  // by the pre-filter above; only free-text search remains. Reuse the same
  // matcher `filterIncidents` uses so search behavior stays in one place.
  const listFiltered = useMemo(
    () => searchFilterIncidents(lineIncidents, search),
    [lineIncidents, search],
  );

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  if (!isKnown) {
    return <NotFoundPage />;
  }

  // Color used for the heading pill + accents. Trains use their CTA brand
  // color; buses fall back to slate to match the bus rows in the timeline.
  const headingBg = isTrain ? trainInfo.color : isMetra ? metraInfo.color : '#64748b';
  const headingText = isTrain ? trainInfo.textColor : isMetra ? metraInfo.textColor : '#fff';

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
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        <div>
          <Breadcrumb items={topLevelTrail(heading)} className="mb-3" />
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
              style={{ backgroundColor: headingBg, color: headingText }}
            >
              {heading}
            </span>
            {!isRail && busName && (
              <span className="text-sm text-slate-500 dark:text-slate-400">{busName}</span>
            )}
            {/* Per-line/route Atom feed — subscribe to just this line/route. A
                feed exists for every CTA line, roster bus route, and Metra line.
                Metra feeds live under the /feed/metra/line/ namespace. */}
            <a
              href={`/feed/${isTrain ? 'line' : isMetra ? 'metra/line' : 'route'}/${effectiveLineId}.xml`}
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 hover:underline"
              title={`Subscribe to ${heading} alerts via RSS/Atom`}
            >
              🔔 Subscribe (RSS)
            </a>
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
            {isMetra && <MetraUpcomingCancellations incidents={lineIncidents} now={now} />}

            {(recentActive.length > 0 || longRunningActive.length > 0) && (
              <ActiveAlerts
                incidents={recentActive}
                longRunningIncidents={longRunningActive}
                now={now}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
              />
            )}

            {burstActive && (
              <div
                className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
                title={`Compared against this line's own 30-day baseline rate. Threshold: ${'≥'}3 incidents AND ${'≥'}2.5${'×'} typical.`}
              >
                <strong>{burst.recentCount}</strong> incident
                {burst.recentCount === 1 ? '' : 's'} in the last {burst.windowHours} hours —{' '}
                <strong>{burst.ratio.toFixed(1)}×</strong> the typical rate for this{' '}
                {isRail ? 'line' : 'route'}.
              </div>
            )}

            {summary &&
              (summary.weeklyCount > 0 ||
                (reliability?.currentStreakDays ?? 0) > 0 ||
                (disruption?.disruptedMinutes ?? 0) > 0 ||
                (metraCancelDelay?.total ?? 0) > 0) && (
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-1">
                  <div className="flex-1 min-w-0 space-y-2">
                    {(() => {
                      // Scannable stat grid (mirrors the homepage's stat cards)
                      // instead of a run-on of small text that wrapped badly on
                      // mobile. Each cell is a bold value + a quiet label.
                      const pct =
                        disruption && disruption.ratio > 0
                          ? disruption.ratio < 0.001
                            ? '<0.1%'
                            : `${(disruption.ratio * 100).toFixed(disruption.ratio < 0.01 ? 2 : 1)}%`
                          : null;
                      // Metra cancellation/delay counts moved to their own
                      // dedicated section below (rates, recency, breakdowns), so
                      // they're no longer duplicated as summary cells here.
                      const cells = [{ v: String(summary.weeklyCount), l: 'in last 7 days' }];
                      if (disruption && disruption.disruptedMinutes > 0) {
                        cells.push({
                          v: formatMinutesAsHours(disruption.disruptedMinutes),
                          l: pct ? `disrupted, 30d · ${pct}` : 'disrupted, 30d',
                        });
                      }
                      if (reliability) {
                        cells.push({
                          v: `${reliability.incidentFreeDays}/${reliability.totalDays}`,
                          l: 'incident-free days (90d)',
                        });
                        if (reliability.longestStreakDays >= 2) {
                          cells.push({
                            v: `${reliability.longestStreakDays}d`,
                            l: 'longest clean streak',
                          });
                        }
                        if (reliability.medianGapHours != null) {
                          cells.push({
                            v: formatGap(reliability.medianGapHours),
                            l: 'median between incidents',
                          });
                        }
                        if (reliability.currentStreakDays >= 2) {
                          cells.push({
                            v: `${reliability.currentStreakDays}d`,
                            l: 'since last incident',
                          });
                        }
                      }
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {cells.map((c) => (
                            <div
                              key={c.l}
                              className="rounded-lg border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface px-3 py-2"
                            >
                              <div className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums leading-tight">
                                {c.v}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                {c.l}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
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
                    {worstDay && worstDay.count >= 2 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Worst day in 90d:{' '}
                        <a
                          href={`/day/${new Date(worstDay.dayUtc).toISOString().slice(0, 10)}`}
                          className="text-blue-500 hover:text-blue-400 hover:underline"
                        >
                          <strong>{formatChicagoDay(worstDay.dayUtc)}</strong>
                        </a>{' '}
                        ({worstDay.count} incident{worstDay.count === 1 ? '' : 's'})
                      </p>
                    )}
                  </div>
                  <TrendSparkline alerts={lineAlerts} observations={lineObservations} />
                </div>
              )}

            {isMetra && <MetraCancellationDelayStats stats={metraCancelDelay} />}

            {/* Geographic station heatmap — rail only (CTA L + Metra), which
                have line/station geometry. Hidden on bus pages. */}
            {isRail && (
              <LineMap
                kind={isMetra ? 'metra' : 'train'}
                lineKey={effectiveLineId}
                stationIndex={stationIndex}
              />
            )}

            {segments.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                  Recurring trouble segments (90d)
                </h2>
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
                  {segments.map((s) => (
                    <div
                      key={`${s.fromStation}|${s.toStation}`}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">
                        {s.fromStation} → {s.toStation}
                      </span>
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                        ×{s.count}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
                  Cold or held stretches detected on the same segment more than once. Direction-
                  aware — a segment can show up twice if both directions have trouble.
                </p>
              </section>
            )}

            <DurationHistogram histogram={durationHistogram} />

            {/* The 90-day per-line grid is the CTA timeline; it has no Metra
                rows, so it's skipped on Metra line pages. */}
            {!isMetra && (
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
            )}

            <DayOfWeekBars data={dayOfWeek} />

            <HourOfWeekHeatmap alerts={lineAlerts} observations={lineObservations} />

            {!isTrain && (
              <SignalBreakdownSingleRoute
                observations={lineObservations}
                label={isMetra ? (metraInfo?.label ?? lineId) : `#${lineId}`}
                labelColor={headingBg}
              />
            )}

            <IncidentList
              incidents={listFiltered}
              search={search}
              onSearchChange={setSearch}
              stationIndex={stationIndex}
              isFiltered
            />
          </>
        )}

        {data && lineAlerts.length === 0 && lineObservations.length === 0 && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            No incidents on record for {heading}.
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
