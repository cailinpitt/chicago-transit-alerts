import { typicalDurationKey } from '../lib/aggregate.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { formatDuration, formatEstimatedEnd } from '../lib/format.js';
import { formatEvidenceChip, getEventId, SIGNAL_LABELS } from '../lib/incidents.js';
import { displayStationName } from '../lib/stations.js';
import LinePill from './LinePill.jsx';
import LongRunningBanner from './LongRunningBanner.jsx';
import ShareLink from './ShareLink.jsx';
import StationName from './StationName.jsx';

const BUS_COLOR = '#64748b';

// Minimum visual span for the gantt — so two near-simultaneous active
// incidents don't render as a zero-width strip the moment they appear.
const GANTT_MIN_SPAN_MS = 15 * 60 * 1000;

// Snap-up ladder for the active-incidents gantt axis. The span anchors on
// the longest-running active incident, then ceiling-rounds to the next rung
// so the axis labels read as predictable round numbers ("1h ago", "6h ago")
// and don't jiggle every render as `now - earliest` ticks forward. Without
// this, a 3h47m-old alert produced a left-edge label of "3h 47m ago" that
// shifted every minute, and the longest bar always reached the literal left
// edge — making any 5-minute-old alert in the same view collapse to a dot.
const GANTT_SPAN_LADDER_MS = [
  15 * 60 * 1000, // 15m
  30 * 60 * 1000, // 30m
  60 * 60 * 1000, // 1h
  2 * 60 * 60 * 1000, // 2h
  3 * 60 * 60 * 1000, // 3h
  6 * 60 * 60 * 1000, // 6h
  12 * 60 * 60 * 1000, // 12h
  24 * 60 * 60 * 1000, // 24h
];

function ceilToGanttSpan(rawSpanMs) {
  for (const step of GANTT_SPAN_LADDER_MS) {
    if (rawSpanMs <= step) return step;
  }
  // Past 24h falls through — incidents older than that are already lifted
  // into LongRunningBanner, so the gantt shouldn't see them. Cap at the
  // ladder's top rung as a graceful fallback if the threshold ever moves.
  return GANTT_SPAN_LADDER_MS[GANTT_SPAN_LADDER_MS.length - 1];
}

// Don't surface a median when fewer than this many past incidents back it.
// Below 5, a single outlier dominates and the hint is more noise than signal.
const TYPICAL_MIN_COUNT = 5;

// Above this count, switch from full red-bordered cards to compact one-line
// rows so a busy day doesn't push the rest of the homepage off the screen.
// The first FULL_CARD_LIMIT incidents stay full-size (most users care about
// the freshest one or two); the rest collapse to compact rows that link
// straight to /event/:id.
const FULL_CARD_LIMIT = 2;

// Pull the description out of an incident for both card and row variants.
// Returns a string-or-JSX `description` plus a flat `descriptionText` that
// the compact row can fall back to when stations are missing (compact rows
// are single-line, no nested links).
function describeIncident(incident, stationIndex) {
  const isAlert = !!incident.alert_id;
  const hasStations = !!(incident.from_station && incident.to_station);
  const signalsText =
    incident.signals?.length > 0
      ? incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')
      : null;

  if (isAlert) {
    return { description: incident.headline, descriptionText: incident.headline };
  }
  if (hasStations) {
    return {
      description: (
        <>
          <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
          <StationName name={incident.to_station} stationIndex={stationIndex} />
        </>
      ),
      descriptionText: `${displayStationName(incident.from_station)} → ${displayStationName(incident.to_station)}`,
    };
  }
  if (incident.from_station || incident.to_station) {
    const name = incident.from_station ?? incident.to_station;
    return {
      description: <StationName name={name} stationIndex={stationIndex} />,
      descriptionText: displayStationName(name),
    };
  }
  if (incident.detection_source === 'roundup' && signalsText) {
    const t = `Multiple signals: ${signalsText}`;
    return { description: t, descriptionText: t };
  }
  if (incident.detection_source === 'roundup') {
    const t = 'Multiple simultaneous disruptions detected';
    return { description: t, descriptionText: t };
  }
  if (signalsText) {
    const t = `Service disruption detected: ${signalsText}`;
    return { description: t, descriptionText: t };
  }
  return {
    description: 'Service disruption detected',
    descriptionText: 'Service disruption detected',
  };
}

function elapsed(now, startTs) {
  return formatDuration(now - startTs) ?? '0m';
}

// Full red-bordered card. Used for the freshest 1–2 active incidents. The
// whole card navigates to /event/:id via an absolutely-positioned link
// overlay — that pattern (rather than wrapping the card in an <a>) lets
// the inner Bluesky and Share links remain real <a>/<button> elements
// without nesting interactive content, which would be invalid HTML.
// The per-card pulsing dot has been dropped: the section header already has
// one, and stacking six of them reads as anxiety, not information.
function ActiveCard({ incident, now, isNew, typicalDurations, stationIndex }) {
  const startTs = incident.first_seen_ts || incident.ts;
  const elapsedText = elapsed(now, startTs);
  const typicalKey = typicalDurationKey(incident);
  const typical = typicalKey && typicalDurations ? typicalDurations.get(typicalKey) : null;
  const typicalText =
    typical && typical.count >= TYPICAL_MIN_COUNT ? formatDuration(typical.medianMs) : null;
  const estimatedEndText = formatEstimatedEnd(incident.cta_event_end_ts, now, {
    dateOnly: incident.cta_event_end_is_date_only === true,
  });
  const { description } = describeIncident(incident, stationIndex);
  const eventId = getEventId(incident);

  return (
    <div
      className={`relative bg-white dark:bg-gh-surface rounded-lg border border-red-200 dark:border-red-900 p-4 ${
        eventId ? 'hover:border-red-300 dark:hover:border-red-800 transition-colors' : ''
      } ${isNew ? 'animate-fade-highlight' : ''}`}
    >
      {/* Card-wide overlay link. Sits behind the inner content (z-0) so
          inner <a>/<button> elements (which get z-10 via .relative) keep
          working independently with middle-click, focus, etc. */}
      {eventId && (
        <a href={`/event/${eventId}`} className="absolute inset-0 z-0 rounded-lg">
          <span className="sr-only">View event details</span>
        </a>
      )}
      {/* `pointer-events-none` on the inner wrapper lets clicks fall through
          to the overlay <a> by default — so any blank pixel on the card
          navigates to /event/:id. The [&_a]:pointer-events-auto and
          [&_button]:pointer-events-auto selectors re-enable clicks on
          actual interactive children (LinePill, StationName links in the
          description, the Bluesky link, ShareLink button) so they keep
          their own destinations. Previously we set `pointer-events-auto`
          on whole wrapping rows, which made big chunks of the card
          unclickable for navigation. */}
      <div className="relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <LinePill kind={incident.kind} line={incident.line} routes={incident.routes} />
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {elapsedText} ongoing
            {typicalText && (
              <>
                {' · '}
                <span title={`Median over ${typical.count} past similar incidents (last 90 days)`}>
                  typically {typicalText}
                </span>
              </>
            )}
            {estimatedEndText && (
              <>
                {' · '}
                <span title="CTA tagged this alert with an estimated end time when it was posted.">
                  CTA estimated end {estimatedEndText}
                </span>
              </>
            )}
          </span>
        </div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
          {description}
        </p>
        {(() => {
          const chip = formatEvidenceChip(incident);
          if (!chip) return null;
          return (
            <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300">
              {chip}
            </span>
          );
        })()}
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
          <ShareLink eventId={eventId} />
        </div>
      </div>
    </div>
  );
}

// Cap on pills shown inside a compact row. A multi-route bus alert can
// touch a dozen routes — rendering them all blows the row up vertically and
// squeezes the description out. Show the first pill, then a "+N" chip; the
// /event/:id page lists every affected route in full.
const COMPACT_PILL_LIMIT = 1;

// Compact one-line variant. Shown for the 3rd+ active incident. Whole row
// links to /event/:id. No description-side links (they wouldn't fit), no
// typical-duration hint (signal-to-noise loss in a single line). Pills are
// capped and the description is truncated so the row stays exactly one line
// regardless of how many routes the alert touches.
function ActiveRow({ incident, now, isNew }) {
  const startTs = incident.first_seen_ts || incident.ts;
  const elapsedText = elapsed(now, startTs);
  const { descriptionText } = describeIncident(incident, null);
  const eventId = getEventId(incident);

  const allRoutes =
    Array.isArray(incident.routes) && incident.routes.length > 0
      ? incident.routes
      : incident.line
        ? [incident.line]
        : [];
  const shownRoutes = allRoutes.slice(0, COMPACT_PILL_LIMIT);
  const overflowCount = allRoutes.length - shownRoutes.length;

  const className = `flex items-center gap-3 px-3 py-2 rounded-md border border-red-200 dark:border-red-900 bg-white dark:bg-gh-surface text-sm hover:border-red-300 dark:hover:border-red-800 transition-colors ${
    isNew ? 'animate-fade-highlight' : ''
  }`;
  const inner = (
    <>
      <span className="flex items-center gap-1 flex-shrink-0">
        <LinePill kind={incident.kind} line={incident.line} routes={shownRoutes} />
        {overflowCount > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 dark:bg-gh-subtle text-slate-600 dark:text-slate-300">
            +{overflowCount}
          </span>
        )}
      </span>
      <span className="flex-1 min-w-0 truncate whitespace-nowrap text-slate-700 dark:text-slate-200">
        {descriptionText}
      </span>
      <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">
        {elapsedText}
      </span>
    </>
  );
  if (eventId) {
    return (
      <a href={`/event/${eventId}`} className={className}>
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

// Compact horizontal ribbon — one bar per active incident on a shared
// time axis. Earliest active incident anchors the left edge; right edge is
// "now". Lets a reader instantly see "this just started" vs "this has been
// running for two hours" without parsing seven separate elapsed-time chips.
// Skipped when only one incident is active (a single bar has nothing to
// compare against and the existing card already shows elapsed time).
function ActiveMiniGantt({ incidents, now }) {
  if (incidents.length < 2) return null;

  const starts = incidents.map((i) => i.first_seen_ts ?? i.ts).filter((t) => t != null);
  if (starts.length === 0) return null;
  const earliest = Math.min(...starts);
  const rawSpan = Math.max(now - earliest, GANTT_MIN_SPAN_MS);
  const span = ceilToGanttSpan(rawSpan);

  // Show three tick labels — left, midpoint, right — so the axis has
  // enough reference points to read against without crowding.
  const midLabel = formatDuration(span / 2);
  const leftLabel = formatDuration(span);

  // Oldest at top so the eye reads down the list as time progresses.
  const sorted = [...incidents].sort(
    (a, b) => (a.first_seen_ts ?? a.ts) - (b.first_seen_ts ?? b.ts),
  );

  return (
    <div className="bg-white dark:bg-gh-surface rounded-lg border border-red-200 dark:border-red-900 px-3 py-2.5 mb-2">
      <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
        Started
      </p>
      <div className="space-y-1">
        {sorted.map((incident) => {
          const start = incident.first_seen_ts ?? incident.ts;
          // Position bars against the bucketed axis (left edge = now - span)
          // rather than the literal earliest start, so the longest-running
          // incident no longer pins to 0% and there's a small visible gap
          // between it and the left edge — the cue that the axis is rounded.
          const axisStart = now - span;
          const leftPct = ((start - axisStart) / span) * 100;
          const widthPct = ((now - start) / span) * 100;
          const eventId = getEventId(incident);
          const isTrain = incident.kind === 'train';
          const lineKey = (Array.isArray(incident.routes) && incident.routes[0]) || incident.line;
          const color = isTrain ? (TRAIN_LINES[lineKey]?.color ?? BUS_COLOR) : BUS_COLOR;
          const elapsedText = elapsed(now, start);
          const label = `${isTrain ? (TRAIN_LINES[lineKey]?.label ?? lineKey) : `#${lineKey}`}: ${elapsedText} ago`;
          // Only the colored bar is interactive — wrapping the whole track
          // would make empty time-of-day space (gray area on either side of
          // the bar) navigate to the incident, which is misleading.
          const barStyle = {
            left: `${leftPct}%`,
            width: `${Math.max(widthPct, 1.5)}%`,
            backgroundColor: color,
          };
          return (
            <div key={eventId ?? `${start}-${lineKey}`} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div
                  role="img"
                  aria-label={label}
                  className="relative h-2 rounded-full bg-slate-100 dark:bg-gh-subtle"
                >
                  {eventId ? (
                    <a
                      href={`/event/${eventId}`}
                      title={label}
                      className="absolute top-0 bottom-0 rounded-full hover:opacity-80 transition-opacity"
                      style={barStyle}
                    >
                      <span className="sr-only">{label}</span>
                    </a>
                  ) : (
                    <div
                      title={label}
                      className="absolute top-0 bottom-0 rounded-full"
                      style={barStyle}
                    />
                  )}
                </div>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums w-14 text-right flex-shrink-0">
                {elapsedText}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-1.5 pr-16">
        <span>{leftLabel} ago</span>
        <span>{midLabel ? `${midLabel} ago` : ''}</span>
        <span>now</span>
      </div>
    </div>
  );
}

// Floor + threshold for the burst chip. The relative ratio alone isn't
// enough — a single incident with zero baseline trivially crosses 2×, but
// "1 incident in 3h" isn't a burst. Require at least 3 in-window incidents
// before claiming anything unusual.
const BURST_RATIO_THRESHOLD = 2;
const BURST_MIN_RECENT = 3;

export default function ActiveAlerts({
  incidents,
  longRunningIncidents = [],
  now = Date.now(),
  highlightedIds,
  typicalDurations,
  stationIndex,
  burst,
}) {
  const burstActive =
    burst != null &&
    burst.recentCount >= BURST_MIN_RECENT &&
    burst.ratio != null &&
    burst.ratio >= BURST_RATIO_THRESHOLD;
  // First 1-2 stay as full cards — the freshest, most-likely-to-investigate
  // incidents get visual weight. Beyond that we collapse to compact rows so
  // a system-wide bad afternoon doesn't push the rest of the page below the
  // fold.
  const fullCount = Math.min(incidents.length, FULL_CARD_LIMIT);
  const fullCards = incidents.slice(0, fullCount);
  const compactRows = incidents.slice(fullCount);

  // Combined active set drives the section count. Long-running incidents
  // are intentionally excluded from the gantt — a multi-day planned alert
  // anchors the time axis at "-4d ago" and squishes the meaningful short-
  // running bars into invisible right-edge slivers. The Day-N rows in the
  // long-running section already make the duration the headline number.
  const totalActive = incidents.length + longRunningIncidents.length;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div aria-hidden="true" className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </div>
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">
          Active Now
          <span className="ml-2 normal-case font-normal text-slate-400 dark:text-slate-500">
            ({totalActive})
          </span>
        </h2>
        {burstActive && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 normal-case tracking-normal"
            title="Recent incident rate vs. the 30-day baseline rate over the same window length."
          >
            {`${burst.recentCount} in ${burst.windowHours}h · ${burst.ratio.toFixed(1)}× typical rate`}
          </span>
        )}
      </div>
      <ActiveMiniGantt incidents={incidents} now={now} />
      <div className="space-y-2">
        {fullCards.map((incident) => {
          const eventId = getEventId(incident);
          return (
            <ActiveCard
              key={incident.alert_id ?? `obs-${incident.id}`}
              incident={incident}
              now={now}
              isNew={eventId != null && highlightedIds?.has(eventId)}
              typicalDurations={typicalDurations}
              stationIndex={stationIndex}
            />
          );
        })}
        {compactRows.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {compactRows.map((incident) => {
              const eventId = getEventId(incident);
              return (
                <ActiveRow
                  key={incident.alert_id ?? `obs-${incident.id}`}
                  incident={incident}
                  now={now}
                  isNew={eventId != null && highlightedIds?.has(eventId)}
                />
              );
            })}
          </div>
        )}
        <LongRunningBanner incidents={longRunningIncidents} now={now} />
      </div>
    </section>
  );
}
