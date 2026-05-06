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
  const [selectedLines, setSelectedLines] = useState([]);
  const [showBus, setShowBus] = useState(true);
  const [dateRange, setDateRange] = useState(90); // days; null = all time

  useEffect(() => {
    // BASE_URL is '/cta-alert-history/' in production, '/' in dev.
    fetch(`${import.meta.env.BASE_URL}data/alerts.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  const activeIncidents = useMemo(() => {
    if (!data) return [];
    return [
      ...data.alerts.filter((a) => a.active),
      ...data.observations.filter((o) => o.active),
    ].sort((a, b) => (b.first_seen_ts || b.ts) - (a.first_seen_ts || a.ts));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return { alerts: [], observations: [] };
    const startTs = dateRange ? Date.now() - dateRange * DAY_MS : null;
    return filterIncidents(data.alerts, data.observations, {
      lines: selectedLines.length > 0 ? selectedLines : null,
      startTs,
      showBus,
    });
  }, [data, selectedLines, showBus, dateRange]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p className="text-red-600 text-sm">Failed to load alert data.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <Header generatedAt={data?.generated_at} dark={dark} onToggleDark={toggleDark} />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        {!data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700" />
            <div className="h-10 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700" />
            <div className="h-48 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700" />
            <div className="h-64 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700" />
          </div>
        )}
        {data && (
          <>
            {activeIncidents.length > 0 && <ActiveAlerts incidents={activeIncidents} />}
            <Filters
              selectedLines={selectedLines}
              onLinesChange={setSelectedLines}
              showBus={showBus}
              onShowBusChange={setShowBus}
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
                  prev.includes(line) ? prev.filter((l) => l !== line) : [line],
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
