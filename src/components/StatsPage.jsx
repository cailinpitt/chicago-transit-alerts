import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  computeMetraLeaderboards,
  computeRestorationDeltas,
  computeSegmentRecurrence,
  computeStatsLeaderboards,
  computeYearOverYear,
} from '../lib/aggregate.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { dataUrl } from '../lib/dataSource.js';
import { formatChicagoDay, formatDate, formatDuration, formatTime } from '../lib/format.js';
import { flattenIncidents, formatRoutesLabel } from '../lib/incidents.js';
import { METRA_LINES } from '../lib/metraLines.js';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function formatHour(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function StatCard({ eyebrow, headline, sub, href }) {
  // Same card frame regardless of metric — keeps the page rhythmically
  // similar to the homepage stack rather than introducing a new visual
  // language. `href` makes the headline a deep link when there's a
  // sensible target; otherwise the card is plain text.
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
        {eyebrow}
      </p>
      <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-snug">
        {headline}
      </p>
      {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
      >
        {body}
      </a>
    );
  }
  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
      {body}
    </div>
  );
}

function RestorationDeltaList({ title, subtitle, rows }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
          {title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{subtitle}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          No incidents in this direction.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border">
      <div className="p-4 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-gh-border">
        {rows.map((row) => {
          const absMs = Math.abs(row.deltaMs);
          const routesLabel = formatRoutesLabel(row.kind, row.routes);
          return (
            <a
              key={row.id}
              href={`/event/${row.id}`}
              className="block px-4 py-2 hover:bg-slate-50 dark:hover:bg-gh-canvas transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {routesLabel}
                </span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                  {formatDuration(absMs)}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {formatChicagoDay(row.firstSeenTs)} · {row.headline ?? 'Bot-corroborated incident'}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const url = dataUrl('alerts.json');
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  useEffect(() => {
    document.title = 'Stats · Chicago Transit Alerts';
    return () => {
      document.title = 'Chicago Transit Alerts';
    };
  }, []);

  // Analytics here read the flat { alerts, observations } shape.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  const leaders = useMemo(() => {
    if (!flat) return null;
    return computeStatsLeaderboards(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [flat, now]);

  const segments = useMemo(() => {
    if (!flat) return [];
    return computeSegmentRecurrence(flat.observations, {
      now,
      windowDays: 90,
      limit: 5,
    });
  }, [flat, now]);

  const yoy = useMemo(() => {
    if (!flat) return null;
    return computeYearOverYear(flat.alerts, flat.observations, {
      now,
      windowDays: 30,
      dataStartTs: data.data_start_ts ?? null,
    });
  }, [flat, data, now]);

  const restorationDeltas = useMemo(() => {
    if (!flat) return null;
    return computeRestorationDeltas(flat.alerts, flat.observations, {
      now,
      windowDays: 90,
      limit: 3,
    });
  }, [flat, now]);

  const metra = useMemo(() => {
    if (!flat) return null;
    return computeMetraLeaderboards(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [flat, now]);

  const longestRoutesLabel = useMemo(() => {
    if (!leaders?.longestIncident) return null;
    return formatRoutesLabel(leaders.longestIncident.kind, leaders.longestIncident.routes);
  }, [leaders]);

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
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-6 space-y-4 w-full flex-1">
        <div>
          <Breadcrumb items={topLevelTrail('Stats')} className="mb-3" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stats</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Worst days, hours, stations, and longest incidents on record.
          </p>
        </div>

        {error && <p className="text-red-600 text-sm">Failed to load stats data.</p>}

        {!error && !data && (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                key={i}
                className="h-20 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border"
              />
            ))}
          </div>
        )}

        {yoy?.enoughData && (
          <StatCard
            eyebrow="Year-over-year (last 30 days)"
            headline={
              yoy.pctChange == null
                ? `${yoy.currentCount} incidents — no comparable activity a year ago`
                : `${yoy.currentCount} incidents — ${
                    yoy.pctChange === 0
                      ? 'unchanged from'
                      : `${Math.abs(Math.round(yoy.pctChange * 100))}% ${
                          yoy.pctChange > 0 ? 'busier than' : 'quieter than'
                        }`
                  } the same window last year (${yoy.priorCount})`
            }
            sub="Trailing 30 days vs the same 30-day window 365 days ago. Counts merged incidents (alerts + bot observations together)."
          />
        )}

        {leaders && (
          <div className="space-y-3">
            {leaders.worstDay ? (
              <StatCard
                eyebrow="Worst day"
                headline={`${formatChicagoDay(leaders.worstDay.dayUtc)} — ${leaders.worstDay.count} incident${leaders.worstDay.count === 1 ? '' : 's'}`}
                sub="Most distinct incidents starting on a single Chicago calendar day."
                href={`/day/${new Date(leaders.worstDay.dayUtc).toISOString().slice(0, 10)}`}
              />
            ) : (
              <StatCard
                eyebrow="Worst day"
                headline="Not enough data yet."
                sub="The bots haven't accumulated enough days to pick a winner."
              />
            )}

            {leaders.worstHour ? (
              <StatCard
                eyebrow="Worst hour of the week"
                headline={`${DAYS[leaders.worstHour.weekday]} ${formatHour(leaders.worstHour.hour)} — ${leaders.worstHour.count} incident${leaders.worstHour.count === 1 ? '' : 's'}`}
                sub="Hour-of-week cell with the most incident starts."
              />
            ) : (
              <StatCard eyebrow="Worst hour of the week" headline="Not enough data yet." />
            )}

            {leaders.worstStation ? (
              <StatCard
                eyebrow="Most-affected station (90d)"
                headline={`${leaders.worstStation.name} — ${leaders.worstStation.count} incident${leaders.worstStation.count === 1 ? '' : 's'}`}
                sub={
                  leaders.worstStation.lines.length > 0
                    ? `Lines: ${leaders.worstStation.lines.map((l) => TRAIN_LINES[l]?.label ?? l).join(', ')}`
                    : null
                }
                href={`/station/${leaders.worstStation.slug}`}
              />
            ) : (
              <StatCard
                eyebrow="Most-affected station (90d)"
                headline="No station-tagged incidents in the window yet."
              />
            )}

            {segments.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 mt-1 px-1">
                  Recurring trouble segments (90d)
                </h2>
                <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
                  {segments.map((s) => {
                    const info = TRAIN_LINES[s.line];
                    return (
                      <a
                        key={`${s.line}|${s.fromStation}|${s.toStation}`}
                        href={`/line/${s.line}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-gh-canvas transition-colors"
                      >
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                          style={{
                            backgroundColor: info?.color ?? '#64748b',
                            color: info?.textColor ?? '#fff',
                          }}
                        >
                          {info?.label ?? s.line}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">
                          {s.fromStation} → {s.toStation}
                        </span>
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                          ×{s.count}
                        </span>
                      </a>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
                  Bot-detected stretches without trains, or held trains, that recurred on the same
                  segment over the last 90 days. Direction-aware — a segment can show up twice if
                  both directions have trouble.
                </p>
              </section>
            )}

            {restorationDeltas &&
              (restorationDeltas.ctaClearedEarly.length > 0 ||
                restorationDeltas.ctaClearedLate.length > 0) && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 mt-1 px-1">
                    Service-restoration delta (90d)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 px-1">
                    On {restorationDeltas.matchedCount} incident
                    {restorationDeltas.matchedCount === 1 ? '' : 's'} where both CTA and the bot
                    have resolution timestamps, the gap between when CTA marked the alert cleared
                    and when the bot saw sustained service recovery.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <RestorationDeltaList
                      title="CTA cleared early"
                      subtitle="Alert closed before trains recovered"
                      rows={restorationDeltas.ctaClearedEarly}
                    />
                    <RestorationDeltaList
                      title="CTA cleared late"
                      subtitle="Service recovered before alert closed"
                      rows={restorationDeltas.ctaClearedLate}
                    />
                  </div>
                </section>
              )}

            {leaders.longestIncident ? (
              <StatCard
                eyebrow="Longest single incident"
                headline={`${longestRoutesLabel} — ${formatDuration(leaders.longestIncident.durationMs)}`}
                sub={
                  <>
                    {leaders.longestIncident.headline
                      ? `${leaders.longestIncident.headline} · `
                      : ''}
                    {formatDate(leaders.longestIncident.startTs)}{' '}
                    {formatTime(leaders.longestIncident.startTs)} →{' '}
                    {formatDate(leaders.longestIncident.endTs)}{' '}
                    {formatTime(leaders.longestIncident.endTs)}
                  </>
                }
                href={`/event/${leaders.longestIncident.id}`}
              />
            ) : (
              <StatCard
                eyebrow="Longest single incident"
                headline="No resolved incidents on record yet."
              />
            )}
          </div>
        )}

        {metra?.hasData && (
          <section className="space-y-3 pt-2">
            <div className="px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Metra (last 90 days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cancellations and 15+ minute delays the bot detected, by line.
                {metra.alertsCount > 0 &&
                  ` Plus ${metra.alertsCount} republished Metra alert${
                    metra.alertsCount === 1 ? '' : 's'
                  }.`}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {metra.topCancelled ? (
                <StatCard
                  eyebrow="Most-cancelled line"
                  headline={`${METRA_LINES[metra.topCancelled.line]?.label ?? metra.topCancelled.line} — ${metra.topCancelled.cancellations} cancellation${metra.topCancelled.cancellations === 1 ? '' : 's'}`}
                  sub="Metra-confirmed and bot-inferred cancellations."
                  href={`/metra/line/${metra.topCancelled.line}`}
                />
              ) : (
                <StatCard
                  eyebrow="Most-cancelled line"
                  headline="No cancellations in the window."
                />
              )}
              {metra.topDelayed ? (
                <StatCard
                  eyebrow="Most-delayed line"
                  headline={`${METRA_LINES[metra.topDelayed.line]?.label ?? metra.topDelayed.line} — ${metra.topDelayed.delays} late-train detection${metra.topDelayed.delays === 1 ? '' : 's'}`}
                  sub="Trains running 15+ minutes behind schedule."
                  href={`/metra/line/${metra.topDelayed.line}`}
                />
              ) : (
                <StatCard eyebrow="Most-delayed line" headline="No major delays in the window." />
              )}
            </div>
            {metra.byLine.length > 0 && (
              <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
                {metra.byLine.map((r) => {
                  const info = METRA_LINES[r.line];
                  return (
                    <a
                      key={r.line}
                      href={`/metra/line/${r.line}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-gh-canvas transition-colors"
                    >
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                        style={{
                          backgroundColor: info?.color ?? '#64748b',
                          color: info?.textColor ?? '#fff',
                        }}
                      >
                        {info?.label ?? r.line}
                      </span>
                      <span className="flex-1 min-w-0 text-sm text-slate-600 dark:text-slate-300 truncate">
                        {r.cancellations} cancelled · {r.delays} late
                      </span>
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums flex-shrink-0">
                        {r.total}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
