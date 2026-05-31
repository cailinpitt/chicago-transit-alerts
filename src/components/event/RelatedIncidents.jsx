import { useMemo } from 'react';
import { formatDate, formatTime } from '../../lib/format.js';
import {
  findContemporaneousOnOtherLines,
  findRelatedIncidents,
  formatRoutesLabel,
  SIGNAL_LABELS,
  splitObservations,
} from '../../lib/incidents.js';
import LinePill from '../LinePill.jsx';
import StationName from '../StationName.jsx';
import { incidentRoutes } from './incidentText.jsx';

function relatedDescription(incident, stationIndex) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    return (
      <>
        <StationName name={primary.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={primary.to_station} stationIndex={stationIndex} />
        {primary.direction_label && (
          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400 font-normal">
            ({primary.direction_label})
          </span>
        )}
      </>
    );
  }
  if (primary?.detection_source === 'roundup' && primary.signals?.length > 0) {
    return `Multiple signals: ${primary.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (primary?.detection_source === 'roundup') return 'Multiple simultaneous disruptions';
  return 'Service disruption detected';
}

// Contemporaneous activity on OTHER lines/routes within ±1h of this event.
// Shared row layout for the "Surrounding 24h" and "Elsewhere on system"
// sections. Both render the same skeleton — date column, metadata chips,
// description, Details link — and both need the whole card to be a link to
// the row's event page. Uses the stretched-link pattern from IncidentList:
// an absolute-positioned overlay anchor sits behind the content; real
// interactive children (StationName, Details) re-enable pointer events so
// they keep their own destinations. Keeping `showLinePill` out of
// RelatedIncidents preserves the existing convention there (the section
// header already names the line, so a pill on every row would be noise).
function ContextRow({ other, stationIndex, showLinePill }) {
  const ts = other.first_seen_ts;
  const otherHasObs = (other.observations?.length ?? 0) > 0;
  const otherIsMerged = !!other.cta && otherHasObs;
  const otherIsAlert = !!other.cta && !otherHasObs;
  const detailsId = other.id;
  return (
    <div className="relative flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-gh-subtle/40 transition-colors">
      {detailsId && (
        <a href={`/event/${detailsId}`} className="absolute inset-0 rounded">
          <span className="sr-only">View event details</span>
        </a>
      )}
      <div className="relative flex items-start gap-3 flex-1 min-w-0 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <div className="flex-shrink-0 w-20 text-right">
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(ts)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatTime(ts)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {showLinePill && <LinePill kind={other.kind} routes={other.routes} />}
            {otherIsMerged && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via CTA + auto-detection
              </span>
            )}
            {!otherIsMerged && otherIsAlert && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">via CTA</span>
            )}
            {!otherIsMerged && !otherIsAlert && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via auto-detection
              </span>
            )}
            {other.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
            {relatedDescription(other, stationIndex)}
          </p>
          {detailsId && (
            <div className="mt-1">
              <a
                href={`/event/${detailsId}`}
                className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
              >
                Details →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function rowKey(other) {
  return other.id;
}

// Companion to RelatedIncidents (which stays scoped to the same line) so a
// reader can tell at a glance whether this disruption sat alongside others
// across the system — a strong hint of a shared root cause (weather, power,
// big-event letout) vs. an isolated incident.
//
// Renders nothing when the time-adjacent window is empty. The window is
// tighter than RelatedIncidents (1h vs 24h) on purpose: cross-line
// causation is meaningful at hour-scale, not day-scale; widening it would
// dilute the signal into "things that happened today".
export function CrossLineContext({ incident, incidents, stationIndex }) {
  const others = useMemo(
    () => findContemporaneousOnOtherLines(incident, incidents),
    [incident, incidents],
  );
  if (others.length === 0) return null;
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Elsewhere on the system (±1h)
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border overflow-hidden">
        {others.map((other) => (
          <ContextRow
            key={rowKey(other)}
            other={other}
            stationIndex={stationIndex}
            showLinePill={true}
          />
        ))}
      </div>
    </section>
  );
}

export function RelatedIncidents({ incident, incidents, stationIndex }) {
  const related = useMemo(() => findRelatedIncidents(incident, incidents), [incident, incidents]);
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
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border overflow-hidden">
        {related.map((other) => (
          <ContextRow
            key={rowKey(other)}
            other={other}
            stationIndex={stationIndex}
            showLinePill={false}
          />
        ))}
      </div>
    </section>
  );
}
