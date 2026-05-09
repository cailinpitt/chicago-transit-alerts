import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { computeTypicalDurations } from '../lib/aggregate.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { normalizeAlertsPayload } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import ActiveAlerts from './ActiveAlerts.jsx';
import Header from './Header.jsx';
import HourOfWeekHeatmap from './HourOfWeekHeatmap.jsx';
import IncidentList from './IncidentList.jsx';

// `/station/:slug` — surfaces every train alert and observation that
// touched a given station within the rolling window. Stations are sparse:
// only train pulse-cold/pulse-held observations and the rare station-scoped
// alert carry endpoint info, so most line incidents won't show up here.
// The page is intentionally narrower than LinePage: no Timeline (a single
// station doesn't make sense as a per-day grid) and no per-line summary
// card.
export default function StationPage({ slug }) {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

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

  const stationIndex = useMemo(() => {
    if (!data) return null;
    return buildStationIndex(data.alerts, data.observations, { now, windowDays: 90 });
  }, [data, now]);

  const station = stationIndex?.get(slug) ?? null;

  const activeIncidents = useMemo(() => {
    if (!station) return [];
    return [
      ...station.alerts.filter((a) => a.active),
      ...station.observations.filter((o) => o.active),
    ].sort((a, b) => (b.first_seen_ts || b.ts) - (a.first_seen_ts || a.ts));
  }, [station]);

  const typicalDurations = useMemo(() => {
    if (!station) return null;
    return computeTypicalDurations(station.alerts, station.observations, {
      now,
      windowDays: 90,
    });
  }, [station, now]);

  const listFiltered = useMemo(() => {
    if (!station) return { alerts: [], observations: [] };
    if (!search.trim()) return { alerts: station.alerts, observations: station.observations };
    const q = search.trim().toLowerCase();
    const matchesText = (s) => s != null && String(s).toLowerCase().includes(q);
    const alertHit = (a) =>
      [a.headline, a.affected_from_station, a.affected_to_station, a.affected_direction].some(
        matchesText,
      );
    const obsHit = (o) =>
      [o.from_station, o.to_station, o.direction].some(matchesText) ||
      (o.signals || []).some(matchesText) ||
      (o.detection_source && matchesText(o.detection_source));
    return {
      alerts: station.alerts.filter(alertHit),
      observations: station.observations.filter(obsHit),
    };
  }, [station, search]);

  useEffect(() => {
    const base = 'CTA Alert History';
    if (!station) {
      document.title = base;
      return;
    }
    const prefix = activeIncidents.length > 0 ? `(${activeIncidents.length}) ` : '';
    document.title = `${prefix}${station.name} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [station, activeIncidents.length]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  if (data && !station) {
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
              No incidents on record for this station ({slug}) in the last 90 days.
            </p>
          </div>
        </main>
      </div>
    );
  }

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
          {station && (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {station.name}
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {station.lines.map((line) => {
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
              </div>
            </div>
          )}
        </div>

        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {station && (
          <>
            {activeIncidents.length > 0 && (
              <ActiveAlerts
                incidents={activeIncidents}
                now={now}
                typicalDurations={typicalDurations}
                stationIndex={stationIndex}
              />
            )}

            <p className="text-sm text-slate-600 dark:text-slate-300 px-1">
              <strong className="text-slate-800 dark:text-slate-100">{station.count}</strong>{' '}
              incident{station.count === 1 ? '' : 's'} on record (last 90 days)
            </p>

            <HourOfWeekHeatmap alerts={station.alerts} observations={station.observations} />

            <IncidentList
              alerts={listFiltered.alerts}
              observations={listFiltered.observations}
              search={search}
              onSearchChange={setSearch}
              stationIndex={stationIndex}
            />
          </>
        )}
      </main>
    </div>
  );
}
