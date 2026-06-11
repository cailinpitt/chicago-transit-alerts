import { useMemo } from 'react';
import { useNow } from '../../hooks/useNow.js';
import {
  computeCohortDurationStats,
  computeHourOfDayContext,
  computeLineDurationRank,
  computeStretchRecurrence,
} from '../../lib/aggregate.js';
import {
  formatDate,
  formatDuration,
  formatEstimatedEnd,
  formatStabilizationDelta,
  formatTime,
} from '../../lib/format.js';
import {
  affectedLineSegments,
  agencyLabel,
  flattenIncidents,
  formatEvidenceChip,
  formatRoutesLabel,
  mergeMatchingIncidents,
  SIGNAL_LABELS,
  splitObservations,
} from '../../lib/incidents.js';
import { stationsServingLines } from '../../lib/stations.js';
import EventMap from '../EventMap.jsx';
import EventReplay from '../EventReplay.jsx';
import LinePill from '../LinePill.jsx';
import MultiLineEventMap from '../MultiLineEventMap.jsx';
import OfficialBadge from '../OfficialBadge.jsx';
import ShareLink from '../ShareLink.jsx';
import StationName from '../StationName.jsx';
import {
  collectAffectedStations,
  expandSharedTrackageSegments,
  groupAffectedStationsByLine,
  linkifyMentionedStations,
  StationChips,
  StationsByLine,
} from './AffectedStations.jsx';
import CopySummary from './CopySummary.jsx';
import {
  buildEventSummaryText,
  computeBotLead,
  computeCtaEstimate,
  computeCtaPlanned,
} from './callouts.js';
import { describe, describeText, incidentRoutes } from './incidentText.jsx';
import { MiniTimeline } from './MiniTimeline.jsx';

// 0–23 Chicago clock hour → "3 PM" / "12 AM". Used by the time-of-day context
// line; kept local since it's the only consumer.
function formatHourLabel(hour) {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

// Compact pill for a severity tier. amber = notable, red = the worst.
function SeverityBadge({ children, tone = 'amber', title }) {
  const cls =
    tone === 'red'
      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}
      title={title}
    >
      {children}
    </span>
  );
}

// The affected_* stations now render as chips at the top of the card;
// formatAffected is only left to surface the direction string (e.g.
// "Northbound only") for alerts that carry one without station scoping.
// Upstream stores the direction as a lowercase keyword (north/south/east/
// west/in/out) — title-case it so the rendered chip reads "South" not
// "south".
function formatAffected(incident) {
  const d = incident.cta?.affected_direction;
  if (!d) return null;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

// Compact horizontal scale showing where this incident's duration sits in
// its cohort of similar resolved incidents (same kind/line/signal). Gives a
// "was this bad or normal?" gut check beyond the bare duration number.
// Hidden when:
//   - The incident is still active (no final duration yet).
//   - The cohort is below the helper's minCohort threshold (any median is
//     too volatile to anchor a comparison).
//   - The incident has no signal to bucket on (pure CTA alerts).
function DurationScale({ stats }) {
  if (!stats || stats.thisMs == null) return null;
  // Scale extends to the max of (this incident, cohort p90) so a much-
  // worse-than-normal incident pushes the bar past the cohort's whisker
  // without inflating the median's apparent position.
  const scaleMax = Math.max(stats.thisMs, stats.p90Ms, stats.medianMs * 2);
  if (scaleMax <= 0) return null;
  const pct = (v) => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  const ratio = stats.medianMs > 0 ? stats.thisMs / stats.medianMs : null;
  let summary;
  if (ratio == null) summary = null;
  else if (ratio >= 1.5) summary = `${ratio.toFixed(1)}× longer than typical`;
  else if (ratio <= 0.67) summary = `${(1 / ratio).toFixed(1)}× shorter than typical`;
  else summary = 'about typical';

  return (
    <div
      className="mt-4 pt-4 border-t border-slate-100 dark:border-gh-border"
      title={`Cohort: ${stats.count} resolved incidents of this signal type on this line in the last 90 days. Median ${formatDuration(stats.medianMs)}, p90 ${formatDuration(stats.p90Ms)}.`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Duration vs typical
        </p>
        {summary && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-700 dark:text-slate-200">{summary}</strong> ({stats.count}{' '}
            similar in 90d)
          </p>
        )}
      </div>
      <div className="relative h-2 rounded-full bg-slate-100 dark:bg-gh-subtle">
        {/* Median tick */}
        <div
          className="absolute top-0 bottom-0 w-px bg-slate-400 dark:bg-slate-500"
          style={{ left: `${pct(stats.medianMs)}%` }}
          title={`Cohort median: ${formatDuration(stats.medianMs)}`}
        />
        {/* p90 tick */}
        <div
          className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600"
          style={{ left: `${pct(stats.p90Ms)}%` }}
          title={`Cohort p90: ${formatDuration(stats.p90Ms)}`}
        />
        {/* This incident's marker — colored, on top of the cohort ticks */}
        <div
          className="absolute -top-0.5 -bottom-0.5 w-1 rounded-sm bg-blue-500"
          style={{ left: `calc(${pct(stats.thisMs)}% - 2px)` }}
        />
      </div>
      {/* Inline legend for the blue marker — the ticks rely on hover titles,
          which don't exist on touch, so name the marker explicitly. */}
      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm bg-blue-500" />
        <span>
          This incident
          {stats.thisMs != null && (
            <>
              {' · '}
              <strong className="text-slate-700 dark:text-slate-200">
                {formatDuration(stats.thisMs)}
              </strong>
            </>
          )}
        </span>
      </div>
      <div className="flex justify-between mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
        <span>0</span>
        <span>median {formatDuration(stats.medianMs)}</span>
        <span>p90 {formatDuration(stats.p90Ms)}</span>
      </div>
    </div>
  );
}

export function EventDetail({ incident, incidents, alerts, observations, stationIndex, dark }) {
  const cta = incident.cta;
  // The official-source agency for this incident's alert block — "Metra" for
  // Metra incidents (whose `cta` block holds Metra's own republished alert),
  // "CTA" otherwise. Threaded through all the "Per CTA" / "via CTA" copy.
  const agency = agencyLabel(incident.kind);
  const { primary, extras } = splitObservations(incident);
  const isMerged = !!cta && !!primary;
  const isAlert = !!cta && !primary;
  const isObsOnly = !cta;

  // Flat reconstruction of just this incident — reproduces the record the old
  // client-side merge produced, so the helpers that still read the flat shape
  // (cohort stats, affectedLineSegments) keep working unchanged.
  const flatSubject = useMemo(() => {
    const f = flattenIncidents([incident]);
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      f.alerts,
      f.observations,
    );
    return merged[0] ?? standaloneAlerts[0] ?? standaloneObs[0] ?? null;
  }, [incident]);

  // For absence-style observations (pulse-cold/thin-gap) the export publishes an
  // onset_ts back-dated to the last observed train; use it as the start so
  // "First seen" lines up with the back-dated duration_ms instead of showing
  // the same minute for first/last seen.
  const startTs = (isObsOnly ? (primary?.onset_ts ?? null) : null) ?? incident.first_seen_ts;
  const endTs = incident.resolved_ts ?? null;
  // Prefer the exported duration_ms when present — it reconciles with onset_ts
  // (resolved_ts - (onset_ts ?? ts)); the raw subtraction is the fallback.
  const durationMs =
    (isObsOnly ? (primary?.duration_ms ?? null) : null) ?? (endTs != null ? endTs - startTs : null);
  const duration = endTs ? formatDuration(durationMs) : null;
  const cohortStats = useMemo(
    () => computeCohortDurationStats(flatSubject, alerts, observations, { windowDays: 90 }),
    [flatSubject, alerts, observations],
  );

  // Wall-clock ticker (1-minute cadence) so an active incident shows a running
  // "ongoing for…" that advances without waiting on the 5-minute data poll.
  const now = useNow();
  const elapsedMs = incident.active && startTs != null ? Math.max(0, now - startTs) : null;

  // ── Severity / context insights ──────────────────────────────────────────
  // All windowed off Date.now() at compute time (no `now` tick dependency) so
  // they recompute on data poll, not every minute. The label they share.
  const routes = incidentRoutes(incident);
  const lineLabel = formatRoutesLabel(incident.kind, routes);

  // Line-wide severity: where this incident's duration ranks among ALL
  // incidents on the line over 30d (any signal, incl. pure CTA alerts).
  const lineRank = useMemo(
    () => computeLineDurationRank(incident, incidents, { windowDays: 30 }),
    [incident, incidents],
  );

  // Signal-cohort severity: derived from the same cohort the DurationScale
  // bar draws (same kind+line+signal, 90d). "Longest" when at/above the
  // cohort max, "top 10%" when at/above p90. Pure CTA alerts have no cohort
  // (cohortStats null) and get no signal badge.
  const signalSeverity = useMemo(() => {
    if (!cohortStats || cohortStats.thisMs == null || cohortStats.count < 5) return null;
    if (cohortStats.thisMs >= cohortStats.maxMs)
      return { tier: 'longest', count: cohortStats.count };
    if (cohortStats.thisMs >= cohortStats.p90Ms) return { tier: 'top10', count: cohortStats.count };
    return null;
  }, [cohortStats]);
  const signalLabel = primary?.detection_source
    ? (SIGNAL_LABELS[primary.detection_source] ?? primary.detection_source)
    : null;

  // Place recurrence: has this exact stretch flared up repeatedly lately?
  const stretchRecurrence = useMemo(
    () =>
      computeStretchRecurrence(incidents, {
        line: primary?.line ?? null,
        fromStation: primary?.from_station ?? null,
        toStation: primary?.to_station ?? null,
        selfId: incident.id,
        windowDays: 90,
      }),
    [incidents, primary, incident.id],
  );

  // Time-of-day: is the hour this started in a busy/quiet one for the line?
  const hourContext = useMemo(
    () => computeHourOfDayContext(incident, incidents, { windowDays: 90 }),
    [incident, incidents],
  );

  // Bot-lead-time callout. When our bot's earliest observation (back-dated to
  // the last train through the cold stretch / earliest signal) predates the
  // CTA alert's post time, surface the lead so the UI doesn't read as if CTA
  // detected first. Skipped under 2 min (CTA effectively kept pace).
  const botLead = computeBotLead({
    isMerged,
    ctaFirstSeenTs: cta?.first_seen_ts ?? null,
    observations: incident.observations,
  });
  const botLeadPhrase = botLead?.phrase ?? null;
  const botLeadOnsetTs = botLead?.onsetTs ?? null;

  // CTA-planned-start callout. When CTA tagged the alert with an EventStart
  // that meaningfully predates our first sighting, the disruption was a
  // planned event scheduled in advance rather than a live reactive post.
  // Skipped when the gap is < 10 minutes (CTA fired effectively in real
  // time) or > 14 days (a stale EventStart from a long-running planned
  // alert isn't informative).
  const ctaStart = cta?.cta_event_start_ts ?? null;
  const ctaPlannedPhrase = computeCtaPlanned({ ctaStartTs: ctaStart, startTs });

  // CTA's claimed end-time vs actual resolution. Pure CTA alerts and merged
  // records carry `cta_event_end_ts` when CTA originally tagged the alert
  // with an EventEnd. When the alert resolved before the stated end, CTA
  // beat their own estimate; when it resolved after, they were optimistic.
  // Skip when only one side is known or the values are >1 week apart (a
  // stale EventEnd from a multi-day planned alert isn't a useful comparison).
  // For still-active incidents, surface CTA's posted end-time as a
  // forward-looking "expected to clear" line rather than the retrospective
  // comparison below. `formatEstimatedEnd` returns null when the estimate
  // is already past or imminent (≤2 min), so an alert running past its
  // estimate quietly hides the now-stale label instead of advertising it.
  const ctaEndIsDateOnly = cta?.cta_event_end_is_date_only === true;
  const activeEndPhrase =
    incident.active && cta?.cta_event_end_ts != null
      ? formatEstimatedEnd(cta.cta_event_end_ts, undefined, { dateOnly: ctaEndIsDateOnly })
      : null;
  // Only show the parenthetical when it adds genuinely new info (a short
  // countdown like "in ~45m", or "later today"). For far-future estimates
  // it falls back to "Mon 4:00 AM", which just duplicates the time and date
  // we already render in bold.
  const showRelativeParenthetical =
    activeEndPhrase != null &&
    (activeEndPhrase.startsWith('in ~') || activeEndPhrase === 'later today');

  // The retrospective "X min early/late" comparison is only meaningful when
  // CTA posted a time. Date-only EventEnd ("through May 25") has no minute
  // precision to compare against, so it's skipped (and the date shown as
  // context elsewhere). See computeCtaEstimate.
  const ctaEnd = cta?.cta_event_end_ts ?? null;
  const ctaEstimateBlock = computeCtaEstimate({
    ctaEndTs: ctaEnd,
    resolvedTs: incident.resolved_ts ?? null,
    dateOnly: ctaEndIsDateOnly,
  });

  // Stabilization delta: only meaningful when the CTA alert cleared before
  // the bot saw service return. The bot's resolved_ts represents sustained
  // recovery (CLEAR_TICKS_TO_RESET consecutive clean passes upstream); CTA
  // often clears its alert the moment the underlying incident ends, even if
  // there's still a backlog working through. The gap between the two is the
  // honest "service back to normal" delay riders feel.
  // While the incident is active, a paired obs's prior resolution doesn't end
  // it — surfacing it would imply a "back to normal" that hasn't happened, so
  // the obs resolution side is suppressed until the alert clears.
  const obsResolvedTs = isMerged && !incident.active ? (primary?.resolved_ts ?? null) : null;
  let stabilizationDelta = null;
  if (
    isMerged &&
    incident.resolved_ts != null &&
    obsResolvedTs != null &&
    obsResolvedTs > incident.resolved_ts
  ) {
    stabilizationDelta = formatStabilizationDelta(obsResolvedTs - incident.resolved_ts);
  }
  const description = describe(incident, stationIndex);
  const affected = formatAffected(incident);
  const affectedStations = collectAffectedStations(incident);
  // Affected stretches as { line, from, to } segments. A bot scopes its
  // detection to one line, but on shared trackage the same stations carry the
  // incident's other lines too — fan the stretch onto them so a Pink+Green
  // event lists (and maps) both lines, not just whichever one the bot fired on.
  const { segments, expanded: sharedTrackage } = expandSharedTrackageSegments(
    affectedLineSegments(incident),
    incidentRoutes(incident),
  );
  // Multi-line incidents split the station list per line (mirrors the map);
  // null for single-line / pure-CTA incidents, which keep the flat chips.
  const stationsByLine = groupAffectedStationsByLine(segments);
  const resolvedUrl = cta ? (cta.resolved_reply_url ?? null) : (primary?.resolved_post_url ?? null);
  const obsResolvedUrl = isMerged && !incident.active ? (primary?.resolved_post_url ?? null) : null;
  const eventId = incident.id;
  // The main post link: CTA's announcement when present, else the bot post.
  const primaryUrl = cta ? cta.post_url : (primary?.post_url ?? null);

  return (
    <article className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
        {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
        {!incident.active && incident.resolved_ts != null && (
          <span className="text-xs font-semibold text-green-600 dark:text-green-400">resolved</span>
        )}
      </div>

      {/* Severity badges — "was this a bad one?" at a glance. The line-wide
          badge ranks duration against every incident on the line (30d); the
          signal badge ranks it against the same-signal cohort the
          DurationScale below draws (90d). Both only appear when notable. */}
      {(lineRank || signalSeverity) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {lineRank && (
            <SeverityBadge
              tone={lineRank.tier === 'longest' ? 'red' : 'amber'}
              title={`Ranked by duration against all ${lineLabel} incidents resolved in the last ${lineRank.windowDays} days (cohort of ${lineRank.count}).`}
            >
              {lineRank.tier === 'longest'
                ? `Longest ${lineLabel} incident in ${lineRank.windowDays}d`
                : `Top 10% longest on ${lineLabel} (${lineRank.windowDays}d)`}
            </SeverityBadge>
          )}
          {signalSeverity && signalLabel && (
            <SeverityBadge
              tone="amber"
              title={`Ranked against ${signalSeverity.count} similar ${signalLabel.toLowerCase()} incidents on ${lineLabel} in the last 90 days.`}
            >
              {signalSeverity.tier === 'longest'
                ? `Longest ${signalLabel.toLowerCase()} on ${lineLabel} (90d)`
                : `Top 10% ${signalLabel.toLowerCase()} on ${lineLabel} (90d)`}
            </SeverityBadge>
          )}
        </div>
      )}

      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-2">
        {description}
      </h1>

      {/* Bot-only incidents had no matching official CTA alert — say so
          plainly. The bot caught something the CTA's own channels didn't
          announce, which is the point of the auto-detection layer. Neutral
          phrasing: plenty of minor disruptions legitimately don't warrant a
          CTA post. */}
      {isObsOnly && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 italic">
          No matching {agencyLabel(incident.kind)} alert — surfaced from live vehicle tracking only.
        </p>
      )}

      {/* Chips only when the headline isn't already the station pair. For
          pure observations the description IS "From → To" — rendering the
          same stations a second time as chunky chips is just redundant
          visual noise. CTA alerts (headlines like "Temporary Reroute" or
          "Service Change") are the case where the chips actually add
          information that isn't already in the headline.
          Skipped for bus events: upstream's affected_from/to_station for
          bus alerts holds cross-street labels (e.g. "Wacker", "Randolph"),
          not rail-station names. The station index is train-only by
          design — linking them produces /station/wacker pages with no
          incidents on record. The cross-street info is already in the bus
          alert headline, so the chips row adds nothing useful. */}
      {cta &&
        incident.kind === 'train' &&
        (stationsByLine ? (
          <StationsByLine
            groups={stationsByLine}
            direction={cta.affected_direction}
            sharedTrackage={sharedTrackage}
          />
        ) : (
          <StationChips stations={affectedStations} direction={cta.affected_direction} />
        ))}

      {/* Metra: stations referenced in the alert text, resolved upstream to
          canonical GTFS names (free-text Metra names don't match the roster, so
          this can't be done in-line). Each links to its Metra station page. */}
      {cta && incident.kind === 'metra' && cta.mentioned_stations?.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
            Stations
          </span>
          {cta.mentioned_stations.map((name, i) => (
            <span key={name} className="inline-flex items-center">
              <StationName name={name} kind="metra" />
              {i < cta.mentioned_stations.length - 1 ? ',' : ''}
            </span>
          ))}
        </p>
      )}

      {isObsOnly && primary?.signals?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Signals
          </span>
          {primary.signals.map((signal) => (
            <span
              key={signal}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-300"
            >
              {SIGNAL_LABELS[signal] ?? signal}
            </span>
          ))}
        </div>
      )}

      {/* Bot-confidence chip — same string the IncidentList row shows
          ("5 stations cold · 2 trains missed"). Without this the event page
          dropped the "why was this detected" context that the row carried,
          which made bot-only incidents look unexplained. Returns null for
          alerts and roundups, so the section silently disappears when
          there's no evidence payload to summarize. */}
      {(() => {
        const chip = isObsOnly ? formatEvidenceChip(primary) : null;
        if (!chip) return null;
        return (
          <div
            className="flex flex-wrap items-center gap-2 mt-2"
            title="The auto-detection signal that triggered this incident. These are derived from the bot's evidence payload at first sighting."
          >
            <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Detection
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-700 dark:text-slate-300">
              {chip}
            </span>
          </div>
        );
      })()}

      {affected && (
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-2">
            Direction
          </span>
          {affected}
        </p>
      )}

      {/* CTA's own body text for the alert — the reroute/closure details the
          CTA published alongside the headline. Rendered verbatim in a quoted
          block so it's visually distinct from the page's derived data and
          attributable to the CTA. Newlines preserved via whitespace-pre-line
          since the CTA feed sometimes uses line breaks to separate
          instructions. */}
      {/* Plain-English narrative for pure bot observations — the "Per bot"
          counterpart to "Per CTA" below. Both sentences are pre-rendered
          server-side in cta-insights/bin/export-web.js so this stays a dumb
          renderer. When the observation is resolved, the detection +
          resolution sentences become two entries on a LinkedIn-style rail
          matching the "Per CTA · N updates" pattern. */}
      {(() => {
        const detection = isObsOnly ? primary?.bot_description : null;
        const resolution = isObsOnly ? primary?.bot_resolved_description : null;
        const bullets = isObsOnly ? primary?.bot_evidence_bullets : null;
        const onsetText = isObsOnly ? (primary?.onset_description ?? null) : null;
        const onsetTs = isObsOnly ? (primary?.onset_ts ?? null) : null;
        if (!detection) return null;
        const joinBullets = (items) => items.map((b) => b.replace(/\.\s*$/, '')).join('; ') + '.';
        const bulletsBlock =
          Array.isArray(bullets) && bullets.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {joinBullets(bullets)}
            </p>
          ) : null;
        // Onset entry — the back-dated start of the gap, oldest on the rail.
        // Absence detections (pulse-cold/thin-gap) post only after the stretch
        // has been cold a while, so the detection dot lands well after the gap
        // actually began; this anchors a "started here" dot at onset_ts so the
        // timeline lines up with "First seen". Only when the export supplied
        // the sentence AND the start is ≥5 min before the post (mirrors the
        // server's own gate, so a stale field can't draw a dot under detection).
        const hasOnset =
          !!onsetText &&
          onsetTs != null &&
          primary?.ts != null &&
          primary.ts - onsetTs >= 5 * 60 * 1000;
        if (!resolution && !hasOnset) {
          return (
            <blockquote className="mt-4 border-l-2 border-slate-300 dark:border-gh-border pl-4 py-1">
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Per bot
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {detection}
              </p>
              {bulletsBlock}
            </blockquote>
          );
        }
        // Newest first: resolution (if cleared), detection, onset (if known).
        // Bullets only belong on the detection entry — the resolution post is a
        // single "back to normal" sentence and the onset is a one-line marker.
        const entries = [];
        if (resolution)
          entries.push({ key: 'resolved', ts: incident.resolved_ts, text: resolution });
        entries.push({ key: 'detect', ts: primary.ts, text: detection, bullets });
        if (hasOnset) entries.push({ key: 'onset', ts: onsetTs, text: onsetText });
        return (
          <section className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Per bot · {entries.length} updates
            </p>
            <ol className="space-y-6">
              {entries.map((e, i) => {
                const isLatest = i === 0;
                const isOldest = i === entries.length - 1;
                // The detection entry is the moment the bot raised the alarm —
                // give it an amber dot + ALERTED badge so the "this is a problem"
                // beat is the visual anchor of the rail. "Alerted" (not
                // "Detected") because the gap may have begun earlier — the onset
                // entry below carries the real start; this marks when we posted.
                // It wins over the Latest badge when it's also the newest entry
                // (an active, not-yet-resolved incident).
                const isDetect = e.key === 'detect';
                return (
                  <li key={e.key} className="relative pl-6">
                    {!isOldest && (
                      <span
                        aria-hidden="true"
                        className="absolute left-[3px] top-2 w-px bg-slate-200 dark:bg-gh-border"
                        style={{ bottom: '-1.5rem' }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={`absolute left-0 top-1.5 w-[7px] h-[7px] rounded-full ring-2 ring-white dark:ring-gh-surface ${
                        isDetect
                          ? 'bg-amber-500'
                          : isLatest
                            ? 'bg-blue-500'
                            : 'bg-slate-400 dark:bg-slate-500'
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatDate(e.ts)} · {formatTime(e.ts)}
                      </p>
                      {isDetect && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400">
                          Alerted
                        </span>
                      )}
                      {isLatest && !isDetect && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-500">
                          Latest
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                      {e.text}
                    </p>
                    {Array.isArray(e.bullets) && e.bullets.length > 0 && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        {joinBullets(e.bullets)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })()}

      {(() => {
        // Linkify pool — same set used for the single-version block below,
        // hoisted so multi-version rendering can apply it per entry without
        // recomputing.
        const linkPool = [
          ...(cta?.mentioned_stations || []),
          ...stationsServingLines(incidentRoutes(incident)),
        ];
        // Normalize to a versions list. The export omits `versions` for a
        // single-version alert, so synthesize one entry from the alert's own
        // fields when there's CTA body text to anchor the section.
        const rawVersions = Array.isArray(cta?.versions) ? cta.versions : null;
        const versions =
          rawVersions && rawVersions.length > 0
            ? rawVersions
            : cta?.short_description
              ? // No headline on the synthesized entry — the page <h1> already
                // shows it, so repeating it in the rail would just duplicate.
                [{ ts: cta.first_seen_ts, short_description: cta.short_description }]
              : [];

        // Build the timeline: CTA's text versions (newest first) plus a
        // synthesized "cleared" entry when the alert is no longer active.
        // Without it, a resolved alert ends on a stale "trains standing"
        // message tagged as the Latest update, which reads as if it's still
        // happening. The clear entry only makes sense once there's CTA copy to
        // anchor the rail, so a content-less alert stays untouched.
        //
        // For merged CTA+bot incidents, interleave bot detection entries
        // (back-dated to obs.onset_ts) so the chronology answers "who detected
        // this first." Each entry is tagged with its source label below.
        const hasResolved = !incident.active && incident.resolved_ts != null;
        const obsDetections = isMerged
          ? (incident.observations || []).map((o) => ({
              type: 'obs-detect',
              ts: o.onset_ts ?? o.ts,
              obs: o,
            }))
          : [];
        const entries = [
          ...versions.map((v) => ({ type: 'version', ...v })),
          ...obsDetections,
        ].sort((a, b) => b.ts - a.ts);
        if (hasResolved && entries.length > 0) {
          entries.unshift({ type: 'cleared', ts: incident.resolved_ts });
        }
        if (entries.length === 0) return null;

        const hasObsEntries = obsDetections.length > 0;
        const sectionTitle = hasObsEntries
          ? `Timeline · ${entries.length} updates`
          : `Per ${agency} · ${entries.length} updates`;
        const sourceLabel = (e) => (e.type === 'obs-detect' ? 'Per bot' : `Per ${agency}`);
        const joinBullets = (items) => items.map((b) => b.replace(/\.\s*$/, '')).join('; ') + '.';

        // A single CTA message with no clear yet — and no bot entries to
        // interleave — stays a simple quote block. Merged incidents always
        // get the rail since they carry at least one obs detection.
        if (entries.length === 1 && !hasObsEntries) {
          const v = entries[0];
          if (!v.short_description) return null;
          return (
            <blockquote className="mt-4 border-l-2 border-slate-300 dark:border-gh-border pl-4 py-1">
              <p className="flex items-center text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Per {agency}
                <OfficialBadge agency={agency} className="ml-1" />
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                {linkifyMentionedStations(v.short_description, linkPool, stationIndex)}
              </p>
            </blockquote>
          );
        }

        return (
          <section className="mt-4">
            <p className="flex items-center text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {sectionTitle}
              {/* Badge only on the agency-scoped title ("Per CTA · N updates");
                  the mixed "Timeline" variant tags official entries inline via
                  the per-entry source label below. */}
              {!hasObsEntries && <OfficialBadge agency={agency} className="ml-1" />}
            </p>
            {/* LinkedIn-style rail: each <li> renders its own connector
                segment running from just below its dot down into the
                space-y gap to meet the next dot. The last (oldest)
                entry skips the segment so the rail ends cleanly at its
                dot instead of trailing past it. */}
            <ol className="space-y-6">
              {entries.map((e, i) => {
                const isLatest = i === 0;
                const isOldest = i === entries.length - 1;
                const isCleared = e.type === 'cleared';
                const isObsDetect = e.type === 'obs-detect';
                // Headline only re-shown when it changed from the next OLDER
                // version (skip non-version entries, which carry no headline).
                // Most edits keep the headline and only revise the body, so
                // reprinting it on every entry would be noise.
                const prevVersion = entries.slice(i + 1).find((x) => x.type === 'version');
                const showHeadline =
                  e.type === 'version' && (!prevVersion || prevVersion.headline !== e.headline);
                return (
                  <li
                    key={e.type === 'obs-detect' ? `obs-${e.obs.id}` : `${e.type}-${e.ts}`}
                    className="relative pl-6"
                  >
                    {!isOldest && (
                      <span
                        aria-hidden="true"
                        className="absolute left-[3px] top-2 w-px bg-slate-200 dark:bg-gh-border"
                        style={{ bottom: '-1.5rem' }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={`absolute left-0 top-1.5 w-[7px] h-[7px] rounded-full ring-2 ring-white dark:ring-gh-surface ${
                        isLatest ? 'bg-blue-500' : 'bg-slate-400 dark:bg-slate-500'
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatDate(e.ts)} · {formatTime(e.ts)}
                      </p>
                      {hasObsEntries && (
                        <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-medium text-slate-500 dark:text-slate-400">
                          {sourceLabel(e)}
                          {!isObsDetect && <OfficialBadge agency={agency} className="ml-1" />}
                        </span>
                      )}
                      {isLatest && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-500">
                          Latest
                        </span>
                      )}
                    </div>
                    {isCleared ? (
                      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        {agency} cleared this alert.
                      </p>
                    ) : isObsDetect ? (
                      <>
                        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                          {e.obs.bot_description}
                        </p>
                        {/* The affected stretch — without it, multiple
                            pulse-cold detections on the same line read as
                            duplicates since the bot_description sentence is
                            generic ("Brown Line service appears degraded…"). */}
                        {e.obs.from_station && e.obs.to_station && (
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            <StationName
                              name={e.obs.from_station}
                              kind={incident.kind}
                              stationIndex={stationIndex}
                            />{' '}
                            →{' '}
                            <StationName
                              name={e.obs.to_station}
                              kind={incident.kind}
                              stationIndex={stationIndex}
                            />
                          </p>
                        )}
                        {Array.isArray(e.obs.bot_evidence_bullets) &&
                          e.obs.bot_evidence_bullets.length > 0 && (
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                              {joinBullets(e.obs.bot_evidence_bullets)}
                            </p>
                          )}
                      </>
                    ) : (
                      <>
                        {showHeadline && e.headline && (
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-1">
                            {e.headline}
                          </p>
                        )}
                        {e.short_description && (
                          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                            {linkifyMentionedStations(e.short_description, linkPool, stationIndex)}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })()}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mt-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
            First seen
          </dt>
          <dd className="text-slate-700 dark:text-slate-200">
            {formatDate(startTs)} · {formatTime(startTs)}
          </dd>
        </div>
        {endTs && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Last seen
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {formatDate(endTs)} · {formatTime(endTs)}
            </dd>
          </div>
        )}
        {duration && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Duration
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">{duration}</dd>
          </div>
        )}
        {/* Live elapsed time for an active incident — ticks each minute. The
            "Duration" row above only renders once resolved, so this is the
            running counterpart while it's still open. */}
        {elapsedMs != null && (
          <div title="Time since this incident was first seen — still ongoing.">
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ongoing for
            </dt>
            <dd className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-medium tabular-nums">
              {formatDuration(elapsedMs)}
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"
              />
            </dd>
          </div>
        )}
        {botLeadPhrase && (
          <div
            className="sm:col-span-2"
            title="Our bot's observation predates CTA's alert post time."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Bot lead time
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              Bot flagged this <strong>{botLeadPhrase}</strong> before {agency}{' '}
              <span className="text-slate-500 dark:text-slate-400 text-xs">
                (first observed {formatTime(botLeadOnsetTs)} on {formatDate(botLeadOnsetTs)};{' '}
                {agency} posted {formatTime(cta.first_seen_ts)})
              </span>
            </dd>
          </div>
        )}
        {ctaPlannedPhrase && (
          <div
            className="sm:col-span-2"
            title="CTA's EventStart predates our first sighting — the alert was planned in advance rather than fired live."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              CTA scheduled
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              <strong>{ctaPlannedPhrase}</strong> of the first sighting{' '}
              <span className="text-slate-500 dark:text-slate-400 text-xs">
                (tagged {formatTime(ctaStart)} on {formatDate(ctaStart)})
              </span>
            </dd>
          </div>
        )}
        {activeEndPhrase && (
          <div
            className="sm:col-span-2"
            title="CTA tagged this alert with an estimated end time (EventEnd) when it was posted."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              CTA estimated end
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {ctaEndIsDateOnly ? (
                <>
                  <strong>{formatDate(ctaEnd)}</strong>
                  {showRelativeParenthetical && (
                    <>
                      {' '}
                      <span className="text-slate-500 dark:text-slate-400 text-xs">
                        ({activeEndPhrase})
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{formatTime(ctaEnd)}</strong> on {formatDate(ctaEnd)}
                  {showRelativeParenthetical && (
                    <>
                      {' '}
                      <span className="text-slate-500 dark:text-slate-400 text-xs">
                        ({activeEndPhrase})
                      </span>
                    </>
                  )}
                </>
              )}
            </dd>
          </div>
        )}
        {/* Date-only EventEnd on a resolved alert: no minute-precision
            comparison to make, so just show CTA's stated through-date as
            context. Skipped when the active block already covered it. */}
        {!incident.active && ctaEndIsDateOnly && ctaEnd != null && incident.resolved_ts != null && (
          <div
            className="sm:col-span-2"
            title="CTA posted this alert's EventEnd as a date with no time, so there's no minute-level comparison to make."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              CTA estimated end
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">{formatDate(ctaEnd)}</dd>
          </div>
        )}
        {ctaEstimateBlock && (
          <div
            className="sm:col-span-2"
            title="CTA tagged this alert with an estimated end time (EventEnd) when it was first posted. This compares that estimate to when the alert actually cleared."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              vs CTA's stated end
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {ctaEstimateBlock.phrase}{' '}
              <span className="text-slate-500 dark:text-slate-400 text-xs">
                (estimated {formatTime(ctaEnd)} on {formatDate(ctaEnd)})
              </span>
            </dd>
          </div>
        )}
        {stabilizationDelta && (
          <div
            className="sm:col-span-2"
            title="Time between CTA marking the alert cleared and the bot seeing sustained normal service. The bot's clear requires several consecutive clean passes, so this is closer to the felt return-to-normal than the CTA timestamp alone."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Service stabilized
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {stabilizationDelta} after {agency} cleared the alert
            </dd>
          </div>
        )}
      </dl>

      {/* Geographic map for train incidents with at least one named
          station. Bus incidents (no geometry data) and alerts that don't
          tag a station fall through to just the mini timeline below.
          Multi-line incidents (a Loop-wide alert that merged several
          per-line detections) use the combined map so every affected line
          shows its own stretch instead of one arbitrary line. */}
      {incident.kind === 'train' &&
        (incidentRoutes(incident).length > 1 ? (
          <MultiLineEventMap
            lineKeys={incidentRoutes(incident)}
            segments={segments}
            active={!!incident.active}
            sharedTrackage={sharedTrackage}
          />
        ) : (
          <EventMap
            lineKey={Array.isArray(incident.routes) ? incident.routes[0] : null}
            fromStation={primary?.from_station ?? cta?.affected_from_station ?? null}
            toStation={primary?.to_station ?? cta?.affected_to_station ?? null}
            active={!!incident.active}
          />
        ))}

      {/* Metra incidents are single-line (one route key), so they always use
          the single-line EventMap — never the multi-line Loop variant. */}
      {incident.kind === 'metra' && (
        <EventMap
          kind="metra"
          lineKey={Array.isArray(incident.routes) ? incident.routes[0] : null}
          fromStation={primary?.from_station ?? cta?.affected_from_station ?? null}
          toStation={primary?.to_station ?? cta?.affected_to_station ?? null}
          active={!!incident.active}
        />
      )}

      {/* Replay — animates the actual vehicle positions from this incident's
          window across the schematic. Renders only when a track file exists
          for this event on the R2 origin (train incidents archived before the
          7-day raw-observation rolloff); otherwise EventReplay returns null. */}
      {incident.kind === 'train' && (
        <EventReplay
          eventId={incident.id}
          // Prefer the affected observation's own line so a multi-route incident
          // (e.g. a shared Orange/Green stretch) projects onto the line the
          // segment is actually on, not whichever route sorts first.
          lineKey={primary?.line ?? (Array.isArray(incident.routes) ? incident.routes[0] : null)}
          fromStation={primary?.from_station ?? cta?.affected_from_station ?? null}
          toStation={primary?.to_station ?? cta?.affected_to_station ?? null}
          directionLabel={primary?.direction_label ?? cta?.affected_direction ?? null}
        />
      )}

      {/* Context insights — place recurrence ("is this a chronic trouble
          spot?") and time-of-day ("a busy hour for this line?"). Both are
          drawn from the surrounding incident set and only render when they
          clear their notability thresholds, so a one-off in a quiet hour
          shows nothing here. */}
      {(stretchRecurrence || hourContext) && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gh-border">
          <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Context
          </p>
          <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            {stretchRecurrence && (
              <li>
                Recurring stretch:{' '}
                <StationName name={stretchRecurrence.fromStation} stationIndex={stationIndex} /> →{' '}
                <StationName name={stretchRecurrence.toStation} stationIndex={stationIndex} /> has
                had{' '}
                <strong className="text-slate-700 dark:text-slate-200">
                  {stretchRecurrence.count} disruptions
                </strong>{' '}
                detected here in the last {stretchRecurrence.windowDays} days.
              </li>
            )}
            {hourContext && (
              <li>
                {hourContext.tier === 'busy' ? (
                  <>
                    <strong className="text-slate-700 dark:text-slate-200">
                      {formatHourLabel(hourContext.hour)}
                    </strong>{' '}
                    is a relatively busy hour for {lineLabel} disruptions — {hourContext.count} of
                    the last {hourContext.total} (90d) landed around then.
                  </>
                ) : (
                  <>
                    An unusually quiet hour for {lineLabel} disruptions — only {hourContext.count}{' '}
                    of the last {hourContext.total} (90d) landed around{' '}
                    <strong className="text-slate-700 dark:text-slate-200">
                      {formatHourLabel(hourContext.hour)}
                    </strong>
                    .
                  </>
                )}
              </li>
            )}
          </ul>
        </div>
      )}

      <DurationScale stats={cohortStats} />

      <MiniTimeline incident={incident} incidents={incidents} dark={dark} />

      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-gh-border">
        <ShareLink eventId={eventId} title={description} />
        <CopySummary
          text={buildEventSummaryText({
            description: describeText(incident),
            lineLabel,
            dateText: formatDate(startTs),
            durationText: duration,
            active: !!incident.active,
            url: typeof window !== 'undefined' ? `${window.location.origin}/event/${eventId}` : '',
          })}
        />
        {primaryUrl && (
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            {isMerged ? `Via ${agency} →` : 'View on Bluesky →'}
          </a>
        )}
        {isMerged && primary?.post_url && (
          <a
            href={primary.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            {extras.length > 0 && primary.detection_source
              ? `Bot detection (${primary.detection_source}) →`
              : 'Bot detection →'}
          </a>
        )}
        {isMerged &&
          extras.map(
            (e) =>
              e.post_url && (
                <a
                  key={e.id}
                  href={e.post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
                >
                  {e.detection_source
                    ? `Bot detection (${e.detection_source}) →`
                    : 'Bot detection →'}
                </a>
              ),
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
