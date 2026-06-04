import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { eventTrail } from '../lib/breadcrumbs.js';
import { findIncidentById, flattenIncidents, formatRoutesLabel } from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import Breadcrumb from './Breadcrumb.jsx';
import BrowseMenu from './BrowseMenu.jsx';
import { EventDetail } from './event/EventDetail.jsx';
import EventNav from './event/EventNav.jsx';
import { describeText, incidentRoutes } from './event/incidentText.jsx';
import { CrossLineContext, RelatedIncidents } from './event/RelatedIncidents.jsx';
import Footer from './Footer.jsx';
import NotFoundPage from './NotFoundPage.jsx';

export default function EventPage({ eventId }) {
  const [dark, toggleDark] = useDarkMode();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Initial fetch + 5-minute poll. Matches App.jsx's cadence so an event
  // page left open on an active incident updates its duration / "ongoing"
  // chip / resolution status without a reload. Only the initial fetch
  // surfaces a hard error — silent failures after that keep the existing
  // data visible rather than yanking the page out from under the reader.
  useEffect(() => {
    const url = `${import.meta.env.VITE_DATA_BASE_URL ?? import.meta.env.BASE_URL + 'data'}/alerts.json`;

    function fetchData() {
      fetch(url, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((fresh) => {
          setData((prev) => {
            if (!prev || fresh.generated_at !== prev.generated_at) return fresh;
            return prev;
          });
        })
        .catch((err) => {
          setData((prev) => {
            if (!prev) setError(err);
            return prev;
          });
        });
    }

    fetchData();
    const id = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const incident = useMemo(() => {
    if (!data) return null;
    return findIncidentById(data.incidents, eventId);
  }, [data, eventId]);

  // Flat { alerts, observations } view of the payload — the station index and
  // BrowseMenu (and, via EventDetail, the cohort stats) still read the flat
  // shape. The view itself renders the nested `incident` directly.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.alerts, flat.observations, { windowDays: 90 });
  }, [flat]);

  // Set the tab title from the incident so bookmarks and shared links land in
  // browser history with something readable, not the generic site title.
  useEffect(() => {
    const base = 'Chicago Transit Alerts';
    if (!incident) {
      document.title = base;
      return;
    }
    // Prefix the tab title with the route label so a generic CTA headline
    // (e.g. "Temporary Reroute") doesn't lose the route context the rest of
    // the page makes obvious.
    const label = formatRoutesLabel(incident.kind, incidentRoutes(incident));
    const desc = describeText(incident);
    document.title = `${label} · ${desc} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [incident]);

  if (data && !incident) {
    return <NotFoundPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        <div className="flex items-center justify-between mb-4">
          <Breadcrumb
            items={
              incident
                ? eventTrail(
                    incident.first_seen_ts ?? incident.ts,
                    formatRoutesLabel(incident.kind, incidentRoutes(incident)),
                  )
                : [{ label: 'Home', href: '/' }, { label: 'Incident' }]
            }
          />
          <div className="flex items-center gap-2">
            <BrowseMenu alerts={flat?.alerts} observations={flat?.observations} />
            <button
              type="button"
              onClick={toggleDark}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
              aria-label="Toggle dark mode"
            >
              {dark ? '☀️' : '🌙'}
              <span>{dark ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">Failed to load alert data.</p>}

        {!error && !data && (
          <div className="h-32 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border animate-pulse" />
        )}

        {incident && (
          <>
            <EventDetail
              incident={incident}
              incidents={data.incidents}
              alerts={flat.alerts}
              observations={flat.observations}
              stationIndex={stationIndex}
              dark={dark}
            />
            <RelatedIncidents
              incident={incident}
              incidents={data.incidents}
              stationIndex={stationIndex}
            />
            <CrossLineContext
              incident={incident}
              incidents={data.incidents}
              stationIndex={stationIndex}
            />
            <EventNav incident={incident} incidents={data.incidents} />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
