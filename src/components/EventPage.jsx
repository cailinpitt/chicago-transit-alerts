import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { formatDate, formatDuration, formatTime } from '../lib/format.js';
import { findIncidentById, SIGNAL_LABELS } from '../lib/incidents.js';
import LinePill from './LinePill.jsx';

function describe(incident, isMerged, isAlert) {
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return `${incident.from_station} → ${incident.to_station}`;
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') {
    return 'Multiple simultaneous disruptions detected';
  }
  return 'Service disruption detected';
}

export default function EventPage({ eventId }) {
  const [dark, toggleDark] = useDarkMode();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;
    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  const incident = useMemo(() => {
    if (!data) return null;
    return findIncidentById(data.alerts, data.observations, eventId);
  }, [data, eventId]);

  // Set the tab title from the incident so bookmarks and shared links land in
  // browser history with something readable, not the generic site title.
  useEffect(() => {
    const base = 'CTA Alert History';
    if (!incident) {
      document.title = base;
      return;
    }
    const isMerged = incident._type === 'merged';
    const isAlert = !isMerged && !!incident.alert_id;
    document.title = `${describe(incident, isMerged, isAlert)} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [incident]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <main className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        <div className="flex items-center justify-between mb-4">
          <a href="/" className="text-sm text-blue-500 hover:text-blue-400 hover:underline">
            ← Back to all incidents
          </a>
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

        {error && <p className="text-red-600 text-sm">Failed to load alert data.</p>}

        {!error && !data && (
          <div className="h-32 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border animate-pulse" />
        )}

        {data && !incident && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              We couldn't find an incident for this link. It may have been removed or the link may
              be incorrect.
            </p>
          </div>
        )}

        {incident && <EventDetail incident={incident} />}
      </main>
    </div>
  );
}

function formatAffected(incident) {
  const from = incident.affected_from_station;
  const to = incident.affected_to_station;
  const dir = incident.affected_direction;
  const segment = from && to ? `${from} → ${to}` : (from ?? to ?? null);
  if (!segment && !dir) return null;
  if (segment && dir) return `${dir} · ${segment}`;
  return segment ?? dir;
}

function EventDetail({ incident }) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;
  const startTs = incident.first_seen_ts || incident.ts;
  const endTs = incident.resolved_ts ?? null;
  const duration = endTs ? formatDuration(endTs - startTs) : null;
  const description = describe(incident, isMerged, isAlert);
  const affected = formatAffected(incident);
  const resolvedUrl = incident.resolved_reply_url ?? incident.resolved_post_url ?? null;
  const obsResolvedUrl = isMerged ? (incident.obs_resolved_post_url ?? null) : null;

  return (
    <article className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <LinePill kind={incident.kind} line={incident.line} routes={incident.routes} />
        {isMerged && (
          <>
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">via CTA</span>
            <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">
              via auto-detection
            </span>
          </>
        )}
        {!isMerged && isAlert && (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">via CTA</span>
        )}
        {!isMerged && !isAlert && (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">
            via auto-detection
          </span>
        )}
        {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
      </div>

      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-2">
        {description}
      </h1>

      {isMerged && incident.from_station && incident.to_station && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
          {incident.from_station} → {incident.to_station}
        </p>
      )}

      {!isMerged && !isAlert && incident.signals?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Signals
          </span>
          {incident.signals.map((signal) => (
            <span
              key={signal}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-300"
            >
              {SIGNAL_LABELS[signal] ?? signal}
            </span>
          ))}
        </div>
      )}

      {affected && (
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-2">
            Affected
          </span>
          {affected}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mt-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
            First seen
          </dt>
          <dd className="text-slate-700 dark:text-slate-200">
            {formatDate(startTs)} · {formatTime(startTs)}
          </dd>
        </div>
        {endTs && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Last seen
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {formatDate(endTs)} · {formatTime(endTs)}
            </dd>
          </div>
        )}
        {duration && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Duration
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">{duration}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-gh-border">
        {incident.post_url && (
          <a
            href={incident.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            {isMerged ? 'Via CTA →' : 'View on Bluesky →'}
          </a>
        )}
        {isMerged && incident.obs_post_url && (
          <a
            href={incident.obs_post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            Bot detection →
          </a>
        )}
        {resolvedUrl && (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            Resolution post →
          </a>
        )}
        {obsResolvedUrl && obsResolvedUrl !== resolvedUrl && (
          <a
            href={obsResolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            Bot resolution →
          </a>
        )}
      </div>
    </article>
  );
}
