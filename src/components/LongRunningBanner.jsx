import { formatDuration } from '../lib/format.js';
import { getEventId } from '../lib/incidents.js';
import LinePill from './LinePill.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;

// Threshold above which an active incident gets lifted out of the regular
// ActiveAlerts stack. 24h is the point where a disruption stops being "what
// just happened" and starts being "the state of this line for a while now"
// — usually a planned reroute, weekend slow zone, or multi-day construction.
export const LONG_RUNNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Cap on how many route pills render inline before collapsing into a "+N".
// A CTA "Temporary Reroute" alert can touch a dozen bus routes; rendering
// all of them blows the row vertically and pushes the headline off-screen.
// Mirrors the same cap used by ActiveRow in ActiveAlerts.jsx.
const COMPACT_PILL_LIMIT = 1;

// Banner row for active incidents older than the threshold. Visually
// quieter than ActiveAlerts (no red accent / pulsing dot) — these are
// structural conditions, not breaking news, and the pulsing-red treatment
// trained on them stops feeling actionable. The "Day N" framing makes
// the duration the headline number.
export default function LongRunningBanner({ incidents, now = Date.now() }) {
  if (!incidents || incidents.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-1">
        Long-running ({incidents.length})
      </h2>
      <div className="space-y-1.5">
        {incidents.map((incident) => {
          const startTs = incident.first_seen_ts ?? incident.ts;
          const elapsed = now - startTs;
          const dayN = Math.floor(elapsed / DAY_MS) + 1;
          const duration = formatDuration(elapsed) ?? '';
          const eventId = getEventId(incident);
          const headline =
            incident.headline ??
            (incident.from_station && incident.to_station
              ? `${incident.from_station} → ${incident.to_station}`
              : 'Ongoing disruption');
          const allRoutes =
            Array.isArray(incident.routes) && incident.routes.length > 0
              ? incident.routes
              : incident.line
                ? [incident.line]
                : [];
          const shownRoutes = allRoutes.slice(0, COMPACT_PILL_LIMIT);
          const overflowCount = allRoutes.length - shownRoutes.length;
          const content = (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <LinePill
                  kind={incident.kind}
                  line={incident.line}
                  routes={shownRoutes}
                />
                {overflowCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 dark:bg-gh-subtle text-slate-600 dark:text-slate-300">
                    +{overflowCount}
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  Day {dayN}
                </span>
                <span
                  className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap"
                  title={`Started ${duration} ago`}
                >
                  · {duration}
                </span>
              </div>
              <p className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200 truncate whitespace-nowrap">
                {headline}
              </p>
            </div>
          );
          return eventId ? (
            <a
              key={incident.alert_id ?? `obs-${incident.id ?? startTs}`}
              href={`/event/${eventId}`}
            >
              {content}
            </a>
          ) : (
            <div key={incident.alert_id ?? `obs-${incident.id ?? startTs}`}>{content}</div>
          );
        })}
      </div>
    </section>
  );
}
