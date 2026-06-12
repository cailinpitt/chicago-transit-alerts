import { useMemo } from 'react';
import { cancellationInfo, cancellationStatusLabel } from '../../lib/cancellation.js';
import { formatDate, formatTime } from '../../lib/format.js';
import {
  agencyLabel,
  findContemporaneousOnOtherLines,
  findRelatedIncidents,
  formatRoutesLabel,
  incidentDetections,
  incidentLifecycle,
  legacyKind,
  metraIncidentStatus,
  officialAlert,
} from '../../lib/incidents.js';
import LinePill from '../LinePill.jsx';
import MetraPointBadge from '../MetraPointBadge.jsx';
import { describe, incidentRoutes } from './incidentText.jsx';

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
  const kind = legacyKind(other);
  const lifecycle = incidentLifecycle(other);
  const ts = lifecycle.first_seen_ts;
  const otherHasObs = incidentDetections(other).length > 0;
  const otherIsMerged = !!officialAlert(other) && otherHasObs;
  const otherIsAlert = !!officialAlert(other) && !otherHasObs;
  const detailsId = other.id;
  // Metra delay/cancellation status badge, whether it came from an official
  // alert classification or an auto-detected point event.
  // Schedule-anchored single-train Metra cancellation (from a Metra alert) →
  // the same 'cancelled' / 'upcoming cancellation' badge the incident list and
  // event page show.
  const cancel = cancellationInfo(other);
  const metraStatus = !cancel ? metraIncidentStatus(other) : null;
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
            {showLinePill && <LinePill kind={kind} routes={other.routes} />}
            {otherIsMerged && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via {agencyLabel(kind)} + auto-detection
              </span>
            )}
            {!otherIsMerged && otherIsAlert && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via {agencyLabel(kind)}
              </span>
            )}
            {!otherIsMerged && !otherIsAlert && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via auto-detection
              </span>
            )}
            {metraStatus && <MetraPointBadge source={metraStatus.source} />}
            {cancel && (
              <span
                className={`text-xs font-semibold ${
                  cancel.isUpcoming
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {cancellationStatusLabel(cancel)}
              </span>
            )}
            {lifecycle.active && (
              <span className="text-xs font-semibold text-red-500">ongoing</span>
            )}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
            {describe(other, stationIndex)}
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
  const lineLabel = formatRoutesLabel(legacyKind(incident), routes);
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
