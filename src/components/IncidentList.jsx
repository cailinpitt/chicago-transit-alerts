import { Fragment, useMemo, useState } from 'react';
import { buildCsv } from '../lib/csv.js';
import {
  chicagoDayUTC,
  formatChicagoDay,
  formatDuration,
  formatEstimatedEnd,
  formatStabilizationDelta,
  formatTime,
} from '../lib/format.js';
import {
  affectedLineSegments,
  agencyLabel,
  botSummaryText,
  flattenIncidents,
  formatEvidenceChip,
  splitObservations,
} from '../lib/incidents.js';
import HighlightedText from './HighlightedText.jsx';
import LinePill from './LinePill.jsx';
import ShareLink from './ShareLink.jsx';
import StationName from './StationName.jsx';

const PAGE_SIZE = 25;

// Build the list of Bluesky sources for this incident. CTA's own alert post
// first (when present), then the bot observation that paired with it, then
// any extra bot observations merged into the same incident. Each entry has
// `url` and `label` so the renderer doesn't have to re-derive labels.
function getSources(incident) {
  const cta = incident.cta;
  const { primary, extras } = splitObservations(incident);
  const out = [];
  if (cta?.post_url) {
    // Merged → "Via CTA" (the bot post follows); pure CTA alert → "View on Bluesky".
    out.push({ url: cta.post_url, label: primary ? 'Via CTA' : 'View on Bluesky' });
  } else if (primary?.post_url) {
    // Bot-only incident: the observation post is the main source.
    out.push({ url: primary.post_url, label: 'View on Bluesky' });
  }
  if (cta && primary?.post_url) {
    out.push({
      url: primary.post_url,
      label: primary.detection_source
        ? `Bot detection (${primary.detection_source})`
        : 'Bot detection',
    });
  }
  if (cta) {
    for (const e of extras) {
      if (!e.post_url) continue;
      out.push({
        url: e.post_url,
        label: e.detection_source ? `Bot detection (${e.detection_source})` : 'Bot detection',
        key: e.id,
      });
    }
  }
  return out;
}

function IncidentRow({ incident, isNew, stationIndex, searchQuery = '' }) {
  const cta = incident.cta;
  const { primary } = splitObservations(incident);
  const isMerged = !!cta && !!primary;
  const isAlert = !!cta && !primary;
  const isObsOnly = !cta;
  const eventId = incident.id;
  const sources = getSources(incident);

  // For a merged incident spanning more than one line (a Loop-wide alert that
  // merged a detection per line), the single primary "from → to" sub-line hides
  // the other lines' stretches. When 2+ lines are involved, show each line's
  // stretch grouped together, divided by a bar. A single-line stretch keeps the
  // plain "from → to" arrow and the line pill above covers attribution.
  const mergedSegments = isMerged ? affectedLineSegments(incident) : [];
  // primary observation endpoints, reused below for the merged single-line row.
  const obsFrom = primary?.from_station ?? null;
  const obsTo = primary?.to_station ?? null;
  const lineGroups = (() => {
    const byLine = new Map();
    for (const seg of mergedSegments) {
      if (!seg.line) continue;
      let list = byLine.get(seg.line);
      if (!list) {
        list = [];
        byLine.set(seg.line, list);
      }
      list.push(seg);
    }
    return [...byLine.entries()].map(([line, segments]) => ({ line, segments }));
  })();
  const isMultiLineSegments = lineGroups.length > 1;

  const startTs = incident.first_seen_ts || primary?.ts;
  const endTs = incident.resolved_ts ?? null;
  // Prefer exported duration_ms (back-dated for absence-style observations).
  const durationMs =
    (isObsOnly ? (primary?.duration_ms ?? null) : null) ?? (endTs != null ? endTs - startTs : null);
  const duration = endTs ? formatDuration(durationMs) : null;

  // Only render the stabilization chip when CTA cleared the alert before the
  // bot saw sustained recovery — that gap is the felt return-to-normal lag.
  const obsResolvedTs = isMerged && !incident.active ? (primary?.resolved_ts ?? null) : null;
  const stabilizationDelta =
    isMerged &&
    incident.resolved_ts != null &&
    obsResolvedTs != null &&
    obsResolvedTs > incident.resolved_ts
      ? formatStabilizationDelta(obsResolvedTs - incident.resolved_ts)
      : null;

  // The description is either highlightable text (alerts/roundups) or a JSX
  // fragment (segment endpoints, where station names may render as links).
  let description;
  // Pre-computed "toward <terminus>" string on the bot observation. Lets two
  // pulse-cold posts on opposite directions of the same line read as distinct
  // at a glance instead of looking identical.
  const directionLabel = primary?.direction_label ?? null;
  if (cta) {
    description = <HighlightedText text={cta.headline} query={searchQuery} />;
  } else if (obsFrom && obsTo) {
    description = (
      <>
        <StationName name={obsFrom} stationIndex={stationIndex} searchQuery={searchQuery} /> →{' '}
        <StationName name={obsTo} stationIndex={stationIndex} searchQuery={searchQuery} />
        {directionLabel && (
          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400 font-normal">
            ({directionLabel})
          </span>
        )}
      </>
    );
  } else {
    description = <HighlightedText text={botSummaryText(incident)} query={searchQuery} />;
  }

  return (
    <div
      className={`cv-auto-row relative flex items-start gap-3 py-3 border-b border-slate-100 dark:border-gh-border last:border-0 ${
        eventId ? 'hover:bg-slate-50 dark:hover:bg-gh-subtle/40 -mx-2 px-2 rounded' : ''
      } ${isNew ? 'animate-fade-highlight' : ''}`}
    >
      {/* Row-wide overlay link — same pattern as ActiveCard. Sits at z-0
          behind the content wrapper (which is pointer-events-none on blank
          pixels). Real interactive children re-enable pointer events via
          [&_a]/[&_button]/[&_summary] so they keep their own destinations
          and don't double-navigate. */}
      {/* No explicit z-index on overlay or content wrapper: an explicit
          z-index would create a stacking context that traps the Sources
          popover inside this row, so the next row's own stacking context
          would paint over it. With z-auto on both, document order alone
          places content above the overlay, and the popover's `z-20`
          escapes to the page root and floats over neighboring rows. */}
      {eventId && (
        <a href={`/event/${eventId}`} className="absolute inset-0 rounded">
          <span className="sr-only">View event details</span>
        </a>
      )}
      <div className="relative flex items-start gap-3 flex-1 min-w-0 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto">
        <div className="flex-shrink-0 w-14 text-right">
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatTime(startTs)}</p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <LinePill kind={incident.kind} routes={incident.routes} />
            {isMerged && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                  via {agencyLabel(incident.kind)}
                </span>
                <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                  via auto-detection
                </span>
              </>
            )}
            {isAlert && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via {agencyLabel(incident.kind)}
              </span>
            )}
            {isObsOnly && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                via auto-detection
              </span>
            )}
            {duration && (
              <>
                <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {duration} duration
                </span>
              </>
            )}
            {!endTs && !incident.active && (
              <span className="text-xs text-slate-500 dark:text-slate-400">duration unknown</span>
            )}
            {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
            {incident.active &&
              cta?.cta_event_end_ts != null &&
              (() => {
                const phrase = formatEstimatedEnd(cta.cta_event_end_ts, undefined, {
                  dateOnly: cta.cta_event_end_is_date_only === true,
                });
                if (!phrase) return null;
                return (
                  <>
                    <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
                    <span
                      className="text-xs text-slate-500 dark:text-slate-400"
                      title="CTA tagged this alert with an estimated end time when it was posted."
                    >
                      CTA estimated end {phrase}
                    </span>
                  </>
                );
              })()}
            {!incident.active && cta?.cta_event_end_ts != null && (
              <>
                <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
                <span
                  className="text-xs text-slate-500 dark:text-slate-400"
                  title="CTA tagged this alert with an estimated end time when it was posted."
                >
                  CTA estimated end{' '}
                  {cta.cta_event_end_is_date_only === true
                    ? formatChicagoDay(chicagoDayUTC(cta.cta_event_end_ts))
                    : formatTime(cta.cta_event_end_ts)}
                </span>
              </>
            )}
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{description}</p>

          {/* Merged, multi-line: each line's stretch grouped together and
              divided by a bar, so a Loop-wide event shows every line's stops
              instead of just the primary obs's stretch. */}
          {isMultiLineSegments && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {lineGroups.map(({ line, segments }, gi) => (
                <Fragment key={line}>
                  {gi > 0 && (
                    <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                      │
                    </span>
                  )}
                  <span className="inline-flex flex-wrap items-center gap-x-1">
                    {segments.map((seg, si) => (
                      <Fragment key={`${seg.from ?? ''}→${seg.to ?? ''}`}>
                        {si > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
                        <StationName
                          name={seg.from}
                          stationIndex={stationIndex}
                          searchQuery={searchQuery}
                        />
                        {seg.from && seg.to && <span aria-hidden="true">→</span>}
                        <StationName
                          name={seg.to}
                          stationIndex={stationIndex}
                          searchQuery={searchQuery}
                        />
                      </Fragment>
                    ))}
                  </span>
                </Fragment>
              ))}
            </p>
          )}

          {/* Merged, single line: show the specific segment from the bot observation */}
          {!isMultiLineSegments && isMerged && obsFrom && obsTo && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <StationName name={obsFrom} stationIndex={stationIndex} searchQuery={searchQuery} /> →{' '}
              <StationName name={obsTo} stationIndex={stationIndex} searchQuery={searchQuery} />
              {directionLabel && <span className="ml-1.5">({directionLabel})</span>}
            </p>
          )}

          {stabilizationDelta && (
            <span
              className="inline-flex items-center mt-1.5 mr-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300"
              title="Time from CTA clearing the alert until the bot saw sustained normal service. Reflects the felt return-to-normal, not just CTA's bookkeeping."
            >
              Stabilized {stabilizationDelta} after CTA cleared
            </span>
          )}

          {/* Bot-confidence chip — pulled from the observation's evidence
            payload. Surfaces "why the bot fired" without requiring a click
            through to Bluesky. */}
          {(() => {
            const chip = isObsOnly ? formatEvidenceChip(primary) : null;
            if (!chip) return null;
            return (
              <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300">
                {chip}
              </span>
            );
          })()}

          {/* Links — Details is the primary action and leads. A single
            Bluesky source renders inline; 2+ collapse into a Sources
            disclosure so the row doesn't sprout three trailing links. */}
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            {eventId && (
              <a
                href={`/event/${eventId}`}
                className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
              >
                Details →
              </a>
            )}
            {sources.length === 1 && (
              <a
                href={sources[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
              >
                {sources[0].label} →
              </a>
            )}
            {sources.length >= 2 && (
              // `<details>` is the no-JS toggle; the panel is positioned
              // `absolute` so opening it floats above the row instead of
              // pushing the row's height (and the day's stacked rows below
              // it) down. `z-20` keeps it above the row's overlay link.
              <details className="text-xs group relative">
                <summary className="cursor-pointer list-none text-blue-500 hover:text-blue-400 hover:underline marker:hidden select-none">
                  Sources ({sources.length}){' '}
                  <span className="inline-block group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[12rem] flex flex-col gap-1 p-2 rounded-md border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface shadow-lg whitespace-nowrap">
                  {sources.map((s, i) => (
                    <a
                      key={s.key ?? `${s.url}-${i}`}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-400 hover:underline"
                    >
                      {s.label} →
                    </a>
                  ))}
                </div>
              </details>
            )}
            <ShareLink eventId={eventId} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IncidentList({
  incidents,
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

  // Trigger a CSV download of the currently filtered incidents. The button is
  // wired to the same `incidents` the list renders, so what the user sees is
  // what they get. The CSV schema is still the flat alerts/observations shape,
  // so flatten just before serializing. Object URL is revoked after the click
  // so we don't leak a Blob URL per export.
  function handleDownloadCsv() {
    const { alerts, observations } = flattenIncidents(incidents);
    const csv = buildCsv(alerts, observations);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `chicago-transit-alerts-${stamp}.csv`;
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
  const rowsForDownload = incidents?.length ?? 0;
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
        className="w-full pl-3 pr-7 py-1 text-xs rounded-full bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:outline-none focus:border-slate-300 dark:focus:border-gh-border focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
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

  // Each incident is already one row — just order newest-first by start.
  const combined = useMemo(() => {
    const all = [...(incidents || [])];
    all.sort((a, b) => b.first_seen_ts - a.first_seen_ts);
    return all;
  }, [incidents]);

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
      const key = chicagoDayUTC(inc.first_seen_ts);
      totalsByDay.set(key, (totalsByDay.get(key) || 0) + 1);
    }
    const out = [];
    let current = null;
    for (const inc of visible) {
      const key = chicagoDayUTC(inc.first_seen_ts);
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
        <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
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
          <span className="normal-case font-normal text-slate-500 dark:text-slate-400">
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
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {group.total} incident{group.total === 1 ? '' : 's'}
              </span>
            </div>
            {group.incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                isNew={incident.id != null && highlightedIds?.has(incident.id)}
                stationIndex={stationIndex}
                searchQuery={search}
              />
            ))}
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
