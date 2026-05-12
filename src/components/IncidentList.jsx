import { Fragment, useMemo, useState } from 'react';
import { buildCsv } from '../lib/csv.js';
import {
  chicagoDayUTC,
  formatChicagoDay,
  formatDuration,
  formatStabilizationDelta,
  formatTime,
} from '../lib/format.js';
import {
  formatEvidenceChip,
  getEventId,
  mergeMatchingIncidents,
  SIGNAL_LABELS,
} from '../lib/incidents.js';
import HighlightedText from './HighlightedText.jsx';
import LinePill from './LinePill.jsx';
import ShareLink from './ShareLink.jsx';
import StationName from './StationName.jsx';

const PAGE_SIZE = 25;

function IncidentRow({ incident, isNew, stationIndex, searchQuery = '' }) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;

  const startTs = incident.first_seen_ts || incident.ts;
  const endTs = incident.resolved_ts ?? null;
  const duration = endTs ? formatDuration(endTs - startTs) : null;

  // Only render the stabilization chip when CTA cleared the alert before the
  // bot saw sustained recovery — that gap is the felt return-to-normal lag.
  const stabilizationDelta =
    isMerged &&
    incident.resolved_ts != null &&
    incident.obs_resolved_ts != null &&
    incident.obs_resolved_ts > incident.resolved_ts
      ? formatStabilizationDelta(incident.obs_resolved_ts - incident.resolved_ts)
      : null;

  // The description is either highlightable text (alerts/roundups) or a JSX
  // fragment (segment endpoints, where station names may render as links).
  let description;
  if (isMerged || isAlert) {
    description = <HighlightedText text={incident.headline} query={searchQuery} />;
  } else if (incident.from_station && incident.to_station) {
    description = (
      <>
        <StationName
          name={incident.from_station}
          stationIndex={stationIndex}
          searchQuery={searchQuery}
        />{' '}
        →{' '}
        <StationName
          name={incident.to_station}
          stationIndex={stationIndex}
          searchQuery={searchQuery}
        />
      </>
    );
  } else if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    description = (
      <HighlightedText
        text={`Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`}
        query={searchQuery}
      />
    );
  } else if (incident.detection_source === 'roundup') {
    description = 'Multiple simultaneous disruptions detected';
  } else {
    description = 'Service disruption detected';
  }

  return (
    <div
      className={`flex items-start gap-3 py-3 border-b border-slate-100 dark:border-gh-border last:border-0 ${
        isNew ? 'animate-fade-highlight' : ''
      }`}
    >
      <div className="flex-shrink-0 w-14 text-right">
        <p className="text-xs text-slate-400 dark:text-slate-500">{formatTime(startTs)}</p>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
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
          {duration && (
            <>
              <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {duration} duration
              </span>
            </>
          )}
          {!endTs && !incident.active && (
            <span className="text-xs text-slate-400 dark:text-slate-500">duration unknown</span>
          )}
          {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{description}</p>

        {/* Merged: show the specific segment from the bot observation */}
        {isMerged && incident.from_station && incident.to_station && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            <StationName
              name={incident.from_station}
              stationIndex={stationIndex}
              searchQuery={searchQuery}
            />{' '}
            →{' '}
            <StationName
              name={incident.to_station}
              stationIndex={stationIndex}
              searchQuery={searchQuery}
            />
          </p>
        )}

        {stabilizationDelta && (
          <span
            className="inline-flex items-center mt-1.5 mr-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300"
            title="Time from CTA clearing the alert until the bot saw sustained normal service. Reflects the felt return-to-normal, not just CTA's bookkeeping."
          >
            stabilized {stabilizationDelta} after CTA cleared
          </span>
        )}

        {/* Bot-confidence chip — pulled from the observation's evidence
            payload. Surfaces "why the bot fired" without requiring a click
            through to Bluesky. */}
        {(() => {
          const chip = formatEvidenceChip(incident);
          if (!chip) return null;
          return (
            <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300">
              {chip}
            </span>
          );
        })()}

        {/* Links */}
        <div className="flex flex-wrap gap-3 mt-1.5">
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

export default function IncidentList({
  alerts,
  observations,
  search = '',
  onSearchChange,
  highlightedIds,
  stationIndex,
  // True when the parent has applied any narrowing (line/route/range/day/
  // signal). The CSV button shows a "(filtered)" hint when true OR when the
  // local search box is non-empty, so the export's scope is obvious without
  // inventing a row-count that mismatches the merged-incident header.
  isFiltered = false,
}) {
  const [page, setPage] = useState(1);

  // Trigger a CSV download of the currently filtered alerts/observations.
  // The button is wired to the same input list `combined` is built from, so
  // what the user sees is exactly what they get — line/date/signal/search
  // filters all already applied upstream. Object URL is revoked after the
  // click so we don't leak a Blob URL per export.
  function handleDownloadCsv() {
    const csv = buildCsv(alerts, observations);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `cta-alert-history-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Always visible — `flex-shrink-0` keeps it from being crushed when the
  // search input claims its share of the row on narrow viewports. Label
  // includes the live row count so it's clear the export is responsive to
  // whatever filters/search are active. Disabled (not hidden) when nothing
  // matches so the affordance stays discoverable.
  const rowsForDownload = (alerts?.length ?? 0) + (observations?.length ?? 0);
  const narrowingActive = isFiltered || search.trim().length > 0;
  const downloadButton = (
    <button
      type="button"
      onClick={handleDownloadCsv}
      disabled={rowsForDownload === 0}
      title={
        rowsForDownload === 0
          ? 'No incidents match the current filters'
          : narrowingActive
            ? 'Download the currently filtered incidents as CSV. Same schema as /data/alerts.csv.'
            : 'Download every incident currently shown as CSV. Same schema as /data/alerts.csv.'
      }
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-100 dark:disabled:hover:bg-gh-subtle flex-shrink-0 whitespace-nowrap"
    >
      ↓ CSV{narrowingActive ? ' (filtered)' : ''}
    </button>
  );

  // Search input lives in this section's header, on the same line as the
  // title, so the cause-effect of typing → results-narrowing is immediate.
  // Reused in both the empty-state and populated branches below.
  const searchInput = onSearchChange ? (
    <div className="relative w-full sm:w-64">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search Red, 66, Chicago, Howard…"
        aria-label="Search by line, route, station, or text"
        title="Search line names (Red, Blue), bus routes by number (66) or name (Chicago), station names (Howard, Belmont), and alert text."
        className="w-full pl-3 pr-7 py-1 text-xs rounded-full bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:outline-none focus:border-slate-300 dark:focus:border-gh-border"
      />
      {search && (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm leading-none"
        >
          ×
        </button>
      )}
    </div>
  ) : null;

  const combined = useMemo(() => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      alerts,
      observations,
    );

    const all = [
      ...merged,
      ...standaloneAlerts.map((a) => ({ ...a, _sortTs: a.first_seen_ts || a.ts })),
      ...standaloneObs.map((o) => ({ ...o, _sortTs: o.first_seen_ts || o.ts })),
    ];
    all.sort((a, b) => b._sortTs - a._sortTs);
    return all;
  }, [alerts, observations]);

  const total = combined.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const visible = combined.slice(0, page * PAGE_SIZE);

  // Group the visible window by Chicago calendar day so the list reads as a
  // commit-feed-style log: a date header with a count, then that day's
  // incidents under it. We also need the per-day total against `combined`
  // (not just `visible`) so the header count doesn't shrink as a day's
  // incidents partly fall off the end of the rendered window.
  const groups = useMemo(() => {
    const totalsByDay = new Map();
    for (const inc of combined) {
      const key = chicagoDayUTC(inc._sortTs);
      totalsByDay.set(key, (totalsByDay.get(key) || 0) + 1);
    }
    const out = [];
    let current = null;
    for (const inc of visible) {
      const key = chicagoDayUTC(inc._sortTs);
      if (!current || current.dayUtc !== key) {
        current = { dayUtc: key, total: totalsByDay.get(key) || 0, incidents: [] };
        out.push(current);
      }
      current.incidents.push(inc);
    }
    return out;
  }, [combined, visible]);

  if (total === 0) {
    return (
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Incident History
          </h2>
          <div className="flex items-center gap-2">
            {downloadButton}
            {searchInput}
          </div>
        </div>
        <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
          {search ? `No incidents match "${search}".` : 'No incidents in this range.'}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Incident History{' '}
          <span className="normal-case font-normal text-slate-400 dark:text-slate-500">
            ({total})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {downloadButton}
          {searchInput}
        </div>
      </div>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border px-4 pt-4 pb-2">
        {groups.map((group) => (
          <Fragment key={group.dayUtc}>
            <div className="flex items-baseline gap-2 pt-4 pb-1 first:pt-0 border-t border-slate-100 dark:border-gh-border first:border-t-0">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {formatChicagoDay(group.dayUtc)}
              </h3>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {group.total} incident{group.total === 1 ? '' : 's'}
              </span>
            </div>
            {group.incidents.map((incident) => {
              const eventId = getEventId(incident);
              return (
                <IncidentRow
                  key={incident.alert_id ?? `obs-${incident.id ?? incident.obs_id}`}
                  incident={incident}
                  isNew={eventId != null && highlightedIds?.has(eventId)}
                  stationIndex={stationIndex}
                  searchQuery={search}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      {page < pageCount && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-gh-surface border border-slate-200 dark:border-gh-border rounded-lg hover:bg-slate-50 dark:hover:bg-gh-border transition-colors"
          >
            Load more ({total - visible.length} remaining)
          </button>
        </div>
      )}
    </section>
  );
}
