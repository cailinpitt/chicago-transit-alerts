import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import { computeTypicalDurations } from '../lib/aggregate.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { dataUrl } from '../lib/dataSource.js';
import {
  flattenIncidents,
  searchFilterIncidents,
  withRuntimeAliasesAll,
} from '../lib/incidents.js';
import { METRA_LINES } from '../lib/metraLines.js';
import { metraStationBySlug } from '../lib/metraStations.js';
import {
  buildStationIndex,
  displayStationName,
  rosterStationBySlug,
  slugifyStation,
} from '../lib/stations.js';
import ActiveAlerts from './ActiveAlerts.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import HourOfWeekHeatmap from './HourOfWeekHeatmap.jsx';
import IncidentList from './IncidentList.jsx';
import NotFoundPage from './NotFoundPage.jsx';

// `/station/:slug` — surfaces every train alert and observation that
// touched a given station within the rolling window. Stations are sparse:
// only train pulse-cold/pulse-held observations and the rare station-scoped
// alert carry endpoint info, so most line incidents won't show up here.
// The page is intentionally narrower than LinePage: no Timeline (a single
// station doesn't make sense as a per-day grid) and no per-line summary
// card.
export default function StationPage({ slug, kind = 'train' }) {
  const isMetra = kind === 'metra';
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const url = dataUrl('alerts.json');
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((fresh) =>
        setData({ ...fresh, incidents: withRuntimeAliasesAll(fresh.incidents || []) }),
      )
      .catch(setError);
  }, []);

  // Flat view feeds the station index (and Header); the list reads nested
  // incidents reconstructed from the station's records below.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  // CTA path uses the activity index (which keys off the train roster). Metra
  // resolves against the Metra roster instead — skip the CTA index entirely.
  const stationIndex = useMemo(() => {
    if (isMetra || !flat) return null;
    return buildStationIndex(flat.alerts, flat.observations, { now, windowDays: 90 });
  }, [isMetra, flat, now]);

  // Metra incidents touching this station: any Metra incident whose origin or
  // destination slugifies to this slug. (Metra cancellation/delay incidents carry
  // from_station/to_station = origin/headsign.)
  const metraStationIncidents = useMemo(() => {
    if (!isMetra || !data) return [];
    return data.incidents.filter((inc) => {
      if (inc.kind !== 'metra') return false;
      return (inc.observations || []).some(
        (o) => slugifyStation(o.from_station) === slug || slugifyStation(o.to_station) === slug,
      );
    });
  }, [isMetra, data, slug]);

  // Unified `station` object: the CTA path reads the activity index (with a
  // roster fallback for quiet stations); the Metra path builds it from the Metra
  // roster + the matched incidents' flattened records (so the heatmap/durations
  // work the same downstream).
  const station = useMemo(() => {
    if (isMetra) {
      const roster = metraStationBySlug(slug);
      if (!roster) return null;
      const f = flattenIncidents(metraStationIncidents);
      return {
        ...roster,
        count: metraStationIncidents.length,
        alerts: f.alerts,
        observations: f.observations,
      };
    }
    return stationIndex?.get(slug) ?? rosterStationBySlug(slug);
  }, [isMetra, slug, stationIndex, metraStationIncidents]);

  // Nested incidents touching this station — for Metra it's the matched set
  // above; for CTA, reconstructed via the station's flat records' `_incidentId`.
  const stationIncidents = useMemo(() => {
    if (!station || !data) return [];
    if (isMetra) return metraStationIncidents;
    const ids = new Set();
    for (const a of station.alerts) if (a._incidentId) ids.add(a._incidentId);
    for (const o of station.observations) if (o._incidentId) ids.add(o._incidentId);
    return data.incidents.filter((inc) => ids.has(inc.id));
  }, [station, data, isMetra, metraStationIncidents]);

  const activeIncidents = useMemo(
    () =>
      stationIncidents
        .filter((inc) => inc.active)
        .sort((a, b) => b.first_seen_ts - a.first_seen_ts),
    [stationIncidents],
  );

  const typicalDurations = useMemo(() => {
    if (!station) return null;
    return computeTypicalDurations(station.alerts, station.observations, {
      now,
      windowDays: 90,
    });
  }, [station, now]);

  const listFiltered = useMemo(
    () => searchFilterIncidents(stationIncidents, search),
    [stationIncidents, search],
  );

  useEffect(() => {
    const base = 'Chicago Transit Alerts';
    if (!station) {
      document.title = base;
      return;
    }
    const prefix = activeIncidents.length > 0 ? `(${activeIncidents.length}) ` : '';
    document.title = `${prefix}${displayStationName(station.name)} · ${base}`;
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
    return <NotFoundPage />;
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
        alerts={flat?.alerts}
        observations={flat?.observations}
      />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full">
        <div>
          <Breadcrumb
            items={topLevelTrail(station ? displayStationName(station.name) : 'Station')}
            className="mb-3"
          />
          {station && (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {displayStationName(station.name)}
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {station.lines.map((line) => {
                  const info = isMetra ? METRA_LINES[line] : TRAIN_LINES[line];
                  if (!info) return null;
                  return (
                    <a
                      key={line}
                      href={isMetra ? `/metra/line/${line}` : `/line/${line}`}
                      className="inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-80 transition-opacity"
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
              incidents={listFiltered}
              search={search}
              onSearchChange={setSearch}
              stationIndex={stationIndex}
              isFiltered
            />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
