import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { computeStatsLeaderboards, computeYearOverYear } from '../lib/aggregate.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { formatChicagoDay, formatDate, formatDuration, formatTime } from '../lib/format.js';
import { formatRoutesLabel, normalizeAlertsPayload } from '../lib/incidents.js';
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

export default function StatsPage() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    document.title = 'Stats · CTA Alert History';
    return () => {
      document.title = 'CTA Alert History';
    };
  }, []);

  const leaders = useMemo(() => {
    if (!data) return null;
    return computeStatsLeaderboards(data.alerts, data.observations, { now, windowDays: 90 });
  }, [data, now]);

  const yoy = useMemo(() => {
    if (!data) return null;
    return computeYearOverYear(data.alerts, data.observations, {
      now,
      windowDays: 30,
      dataStartTs: data.data_start_ts ?? null,
    });
  }, [data, now]);

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
        alerts={data?.alerts}
        observations={data?.observations}
      />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4 w-full flex-1">
        <div>
          <a
            href="/"
            className="text-sm text-blue-500 hover:text-blue-400 hover:underline inline-block mb-3"
          >
            ← Back to all incidents
          </a>
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
                href={`/?day=${new Date(leaders.worstDay.dayUtc).toISOString().slice(0, 10)}`}
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
      </main>
    </div>
  );
}
