import { TRAIN_LINES } from '../lib/ctaLines.js';

function LinePill({ kind, line, routes }) {
  const keys = routes?.length > 0 ? routes : [line];
  return (
    <>
      {keys.map((key) => {
        const info = kind === 'train' ? TRAIN_LINES[key] : null;
        if (info) {
          return (
            <span
              key={key}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: info.color, color: info.textColor }}
            >
              {info.label} Line
            </span>
          );
        }
        return (
          <span
            key={key}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700 text-white"
          >
            {kind === 'bus' ? `Route ${key}` : key}
          </span>
        );
      })}
    </>
  );
}

function ActiveCard({ incident }) {
  const isAlert = !!incident.alert_id;
  const startTs = incident.first_seen_ts || incident.ts;
  const elapsedMin = Math.round((Date.now() - startTs) / 60_000);
  const description = isAlert
    ? incident.headline
    : [incident.from_station, incident.to_station].filter(Boolean).join(' → ') ||
      'Service disruption detected';

  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-red-200 dark:border-red-900 p-4 flex items-start gap-3">
      {/* Pulsing dot */}
      <div className="relative mt-1.5 flex-shrink-0 h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <LinePill kind={incident.kind} line={incident.line} routes={incident.routes} />
          <span className="text-xs text-slate-400 dark:text-slate-500">{elapsedMin}m ongoing</span>
        </div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{description}</p>
        {incident.post_url && (
          <a
            href={incident.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1.5 text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            View on Bluesky →
          </a>
        )}
      </div>
    </div>
  );
}

export default function ActiveAlerts({ incidents }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </div>
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">
          Active Now
        </h2>
      </div>
      <div className="space-y-2">
        {incidents.map((incident) => (
          <ActiveCard key={incident.alert_id ?? `obs-${incident.id}`} incident={incident} />
        ))}
      </div>
    </section>
  );
}
