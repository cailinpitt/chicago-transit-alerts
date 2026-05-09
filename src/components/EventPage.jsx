import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import {
  chicagoDayUTC,
  formatChicagoDay,
  formatDate,
  formatDuration,
  formatTime,
  hexToRgba,
} from '../lib/format.js';
import {
  findIncidentById,
  findRelatedIncidents,
  formatRoutesLabel,
  getEventId,
  mergeMatchingIncidents,
  normalizeAlertsPayload,
  SIGNAL_LABELS,
} from '../lib/incidents.js';
import { buildStationIndex } from '../lib/stations.js';
import BrowseMenu from './BrowseMenu.jsx';
import LinePill from './LinePill.jsx';
import ShareLink from './ShareLink.jsx';
import StationName from './StationName.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUS_COLOR = '#64748b'; // slate-500 — mirrors Timeline's bus row tint.

// Pull the routes/line out of an incident in a uniform shape. Alerts/merged
// records carry plural `routes`; standalone observations carry singular `line`.
function incidentRoutes(incident) {
  if (Array.isArray(incident?.routes) && incident.routes.length > 0) return incident.routes;
  if (incident?.line) return [incident.line];
  return [];
}

// Build a fixed-window day-by-day count of incidents on the given line/route,
// centered on the event's day. Used for the mini timeline that puts the event
// in the context of the surrounding ~2 weeks of activity on the same line.
function buildEventLineWindow(incident, alerts, observations, numDays = 14, now = Date.now()) {
  const routes = new Set(incidentRoutes(incident));
  const kind = incident.kind;
  const startTs = incident.first_seen_ts ?? incident.ts;
  if (routes.size === 0 || startTs == null) return null;
  const centerDayUtc = chicagoDayUTC(startTs);
  const todayUtc = chicagoDayUTC(now);
  // Center the window on the event day, but never show future days past today
  // — they'd be misleading "no data" cells. If centering would clip a long-
  // ago event's window, the window slides forward to extend further past the
  // event instead.
  const halfBefore = Math.floor((numDays - 1) / 2);
  const halfAfter = numDays - 1 - halfBefore;
  const desiredEnd = centerDayUtc + halfAfter * DAY_MS;
  const endDay = Math.min(desiredEnd, todayUtc);
  const startDay = endDay - (numDays - 1) * DAY_MS;

  const days = [];
  for (let i = 0; i < numDays; i++) {
    days.push({ dayUtc: startDay + i * DAY_MS, count: 0 });
  }

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);
  function bump(ts, incRoutes, incKind) {
    if (incKind !== kind) return;
    if (!incRoutes.some((r) => routes.has(r))) return;
    const dayUtc = chicagoDayUTC(ts);
    const idx = Math.round((dayUtc - startDay) / DAY_MS);
    if (idx < 0 || idx >= numDays) return;
    days[idx].count += 1;
  }
  for (const m of merged) bump(m.first_seen_ts, m.routes || [], m.kind);
  for (const a of standaloneAlerts) bump(a.first_seen_ts, a.routes || [], a.kind);
  for (const o of standaloneObs) bump(o.first_seen_ts ?? o.ts, [o.line], o.kind);

  return { days, centerDayUtc };
}

function MiniTimeline({ incident, alerts, observations }) {
  const windowData = useMemo(
    () => buildEventLineWindow(incident, alerts, observations),
    [incident, alerts, observations],
  );
  if (!windowData) return null;
  const { days, centerDayUtc } = windowData;
  const lineKey = incidentRoutes(incident)[0];
  const trainInfo = incident.kind === 'train' ? TRAIN_LINES[lineKey] : null;
  const color = trainInfo ? trainInfo.color : BUS_COLOR;

  function cellBg(count) {
    if (count === 0) return 'var(--timeline-empty)';
    if (count === 1) return hexToRgba(color, 0.4);
    return color;
  }

  // Short month/day labels for the range endpoints. The full formatDate
  // ("Apr 24, 2026") is overkill at 14-day scale and crowds the row, but the
  // year is needed when the range straddles a year boundary so a Dec→Jan
  // window doesn't read as 2026 → 2026.
  const firstDay = days[0].dayUtc;
  const lastDay = days[days.length - 1].dayUtc;
  const sameYear = new Date(firstDay).getUTCFullYear() === new Date(lastDay).getUTCFullYear();
  // dayUtc is a UTC-midnight epoch by construction (chicagoDayUTC builds it
  // from Chicago Y/M/D), so format it as UTC to read those date components
  // back. Using timeZone='America/Chicago' would shift it back 5-6 h and
  // render the previous calendar day.
  const labelFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
  const firstLabel = labelFmt.format(new Date(firstDay));
  const lastLabel = labelFmt.format(new Date(lastDay));

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gh-border">
      <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
        Surrounding {days.length} days on{' '}
        {formatRoutesLabel(incident.kind, incidentRoutes(incident))}
      </p>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map(({ dayUtc, count }) => {
          const isPinned = dayUtc === centerDayUtc;
          const label = `${formatChicagoDay(dayUtc)}: ${count} incident${count === 1 ? '' : 's'}`;
          return (
            <div
              key={dayUtc}
              title={label}
              className={`aspect-square rounded-sm ${
                isPinned ? 'ring-1 ring-slate-700 dark:ring-slate-200' : ''
              }`}
              style={{ backgroundColor: cellBg(count) }}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-slate-400 dark:text-slate-500 tabular-nums">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

function relatedDescription(incident, stationIndex) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return (
      <>
        <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={incident.to_station} stationIndex={stationIndex} />
      </>
    );
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') return 'Multiple simultaneous disruptions';
  return 'Service disruption detected';
}

function RelatedIncidents({ incident, alerts, observations, stationIndex }) {
  const related = useMemo(
    () => findRelatedIncidents(incident, alerts, observations),
    [incident, alerts, observations],
  );
  if (related.length === 0) return null;
  // Routes the parent event affects — used to label the section without
  // re-deriving from each row (all rows share at least one of these).
  const routes = incidentRoutes(incident);
  const lineLabel = formatRoutesLabel(incident.kind, routes);
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Surrounding 24 hours on {lineLabel}
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
        {related.map((other) => {
          const ts = other.first_seen_ts ?? other.ts;
          const otherIsMerged = other._type === 'merged';
          const otherIsAlert = !otherIsMerged && !!other.alert_id;
          const eventId = other.alert_id ? other.alert_id : `obs-${other.id ?? other.obs_id ?? ts}`;
          return (
            <div key={eventId} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-shrink-0 w-20 text-right">
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(ts)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatTime(ts)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {otherIsMerged && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA + auto-detection
                    </span>
                  )}
                  {!otherIsMerged && otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA
                    </span>
                  )}
                  {!otherIsMerged && !otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via auto-detection
                    </span>
                  )}
                  {other.active && (
                    <span className="text-xs font-semibold text-red-500">ongoing</span>
                  )}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
                  {relatedDescription(other, stationIndex)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Plain-string variant of `describe` for places that can't render JSX —
// document.title, plain text logging, etc.
function describeText(incident, isMerged, isAlert) {
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return `${incident.from_station} → ${incident.to_station}`;
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  return 'Service disruption detected';
}

function describe(incident, isMerged, isAlert, stationIndex) {
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return (
      <>
        <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={incident.to_station} stationIndex={stationIndex} />
      </>
    );
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
      .then((raw) => setData(normalizeAlertsPayload(raw)))
      .catch(setError);
  }, []);

  const incident = useMemo(() => {
    if (!data) return null;
    return findIncidentById(data.alerts, data.observations, eventId);
  }, [data, eventId]);

  const stationIndex = useMemo(() => {
    if (!data) return null;
    return buildStationIndex(data.alerts, data.observations, { windowDays: 90 });
  }, [data]);

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
    // Prefix the tab title with the route label so a generic CTA headline
    // (e.g. "Temporary Reroute") doesn't lose the route context the rest of
    // the page makes obvious.
    const label = formatRoutesLabel(incident.kind, incidentRoutes(incident));
    const desc = describeText(incident, isMerged, isAlert);
    document.title = `${label} · ${desc} · ${base}`;
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
          <div className="flex items-center gap-2">
            <BrowseMenu alerts={data?.alerts} observations={data?.observations} />
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

        {data && !incident && (
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              We couldn't find an incident for this link. It may have been removed or the link may
              be incorrect.
            </p>
          </div>
        )}

        {incident && (
          <>
            <EventDetail
              incident={incident}
              alerts={data.alerts}
              observations={data.observations}
              stationIndex={stationIndex}
            />
            <RelatedIncidents
              incident={incident}
              alerts={data.alerts}
              observations={data.observations}
              stationIndex={stationIndex}
            />
          </>
        )}
      </main>
    </div>
  );
}

function formatAffected(incident, stationIndex) {
  const from = incident.affected_from_station;
  const to = incident.affected_to_station;
  const dir = incident.affected_direction;
  if (!from && !to && !dir) return null;
  const segment =
    from && to ? (
      <>
        <StationName name={from} stationIndex={stationIndex} /> →{' '}
        <StationName name={to} stationIndex={stationIndex} />
      </>
    ) : from || to ? (
      <StationName name={from ?? to} stationIndex={stationIndex} />
    ) : null;
  if (segment && dir) {
    return (
      <>
        {dir} · {segment}
      </>
    );
  }
  return segment ?? dir;
}

function EventDetail({ incident, alerts, observations, stationIndex }) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;
  const startTs = incident.first_seen_ts || incident.ts;
  const endTs = incident.resolved_ts ?? null;
  const duration = endTs ? formatDuration(endTs - startTs) : null;
  const description = describe(incident, isMerged, isAlert, stationIndex);
  const affected = formatAffected(incident, stationIndex);
  const resolvedUrl = incident.resolved_reply_url ?? incident.resolved_post_url ?? null;
  const obsResolvedUrl = isMerged ? (incident.obs_resolved_post_url ?? null) : null;
  const eventId = getEventId(incident);

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
          <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
          <StationName name={incident.to_station} stationIndex={stationIndex} />
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

      <MiniTimeline incident={incident} alerts={alerts} observations={observations} />

      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-gh-border">
        <ShareLink eventId={eventId} title={description} />
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
