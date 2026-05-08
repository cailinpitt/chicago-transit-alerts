import { getEventId, SIGNAL_LABELS } from '../lib/incidents.js';
import LinePill from './LinePill.jsx';
import ShareLink from './ShareLink.jsx';

function ActiveCard({ incident, now, isNew }) {
  const isAlert = !!incident.alert_id;
  const startTs = incident.first_seen_ts || incident.ts;
  const elapsedMin = Math.round((now - startTs) / 60_000);
  const stations = [incident.from_station, incident.to_station].filter(Boolean).join(' → ');
  const signalsText =
    incident.signals?.length > 0
      ? incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')
      : null;
  let description;
  if (isAlert) {
    description = incident.headline;
  } else if (stations) {
    description = stations;
  } else if (incident.detection_source === 'roundup' && signalsText) {
    description = `Multiple signals: ${signalsText}`;
  } else if (incident.detection_source === 'roundup') {
    description = 'Multiple simultaneous disruptions detected';
  } else if (signalsText) {
    description = `Service disruption detected: ${signalsText}`;
  } else {
    description = 'Service disruption detected';
  }

  return (
    <div
      className={`bg-white dark:bg-gh-surface rounded-lg border border-red-200 dark:border-red-900 p-4 flex items-start gap-3 ${
        isNew ? 'animate-fade-highlight' : ''
      }`}
    >
      {/* Pulsing dot */}
      <div className="relative mt-1.5 flex-shrink-0 flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <LinePill kind={incident.kind} line={incident.line} routes={incident.routes} />
          <span className="text-xs text-slate-400 dark:text-slate-500">{elapsedMin}m ongoing</span>
        </div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
          {description}
        </p>
        <div className="flex flex-wrap gap-3 mt-1.5">
          {incident.post_url && (
            <a
              href={incident.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
            >
              View on Bluesky →
            </a>
          )}
          {getEventId(incident) && (
            <a
              href={`/event/${getEventId(incident)}`}
              className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
            >
              Details →
            </a>
          )}
          <ShareLink eventId={getEventId(incident)} />
        </div>
      </div>
    </div>
  );
}

export default function ActiveAlerts({ incidents, now = Date.now(), highlightedIds }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </div>
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">Active Now</h2>
      </div>
      <div className="space-y-2">
        {incidents.map((incident) => {
          const eventId = getEventId(incident);
          return (
            <ActiveCard
              key={incident.alert_id ?? `obs-${incident.id}`}
              incident={incident}
              now={now}
              isNew={eventId != null && highlightedIds?.has(eventId)}
            />
          );
        })}
      </div>
    </section>
  );
}
