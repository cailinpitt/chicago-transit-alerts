import { useState, useEffect, useMemo } from 'react';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import ActiveAlerts from './components/ActiveAlerts.jsx';
import Filters from './components/Filters.jsx';
import Timeline from './components/Timeline.jsx';
import IncidentList from './components/IncidentList.jsx';
import { filterIncidents } from './lib/dataUtils.js';
import { useDarkMode } from './hooks/useDarkMode.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function App() {
  const [dark, toggleDark] = useDarkMode();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedLines, setSelectedLines] = useState(null); // null = all lines; [] = no lines
  const [showBus, setShowBus] = useState(true);
  const [selectedBusRoutes, setSelectedBusRoutes] = useState([]);
  const [dateRange, setDateRange] = useState(90); // days; null = all time

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;

    function fetchData() {
      fetch(url)
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
          setData((prev) => { if (!prev) setError(err); return prev; });
        });
    }

    fetchData();
    const id = setInterval(fetchData, 2 * 60 * 1000); // poll every 2 minutes
    return () => clearInterval(id);
  }, []);

  const activeIncidents = useMemo(() => {
    if (!data) return [];
    return [
      ...data.alerts.filter((a) => a.active),
      ...data.observations.filter((o) => o.active),
    ].sort((a, b) => (b.first_seen_ts || b.ts) - (a.first_seen_ts || a.ts));
  }, [data]);

  const availableBusRoutes = useMemo(() => {
    if (!data) return [];
    const routes = new Set([
      ...data.observations.filter((o) => o.kind === 'bus').map((o) => o.line),
      ...data.alerts.filter((a) => a.kind === 'bus').flatMap((a) => a.routes),
    ]);
    return [...routes].sort((a, b) => +a - +b);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return { alerts: [], observations: [] };
    const startTs = dateRange ? Date.now() - dateRange * DAY_MS : null;
    return filterIncidents(data.alerts, data.observations, {
      lines: selectedLines,
      startTs,
      showBus,
      busRoutes: selectedBusRoutes.length > 0 ? selectedBusRoutes : null,
    });
  }, [data, selectedLines, showBus, selectedBusRoutes, dateRange]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header generatedAt={data?.generated_at} dark={dark} onToggleDark={toggleDark} />
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
              onLinesChange={setSelectedLines}
              showBus={showBus}
              onShowBusChange={(val) => {
                setShowBus(val);
                if (!val) setSelectedBusRoutes([]);
              }}
              availableBusRoutes={availableBusRoutes}
              selectedBusRoutes={selectedBusRoutes}
              onBusRoutesChange={setSelectedBusRoutes}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <Timeline
              alerts={data.alerts}
              observations={data.observations}
              selectedLines={selectedLines}
              numDays={dateRange ?? 90}
              dataStartTs={data.data_start_ts ?? null}
              onLineClick={(line) =>
                setSelectedLines((prev) =>
                  prev !== null && prev.includes(line) ? prev.filter((l) => l !== line) : [line],
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
