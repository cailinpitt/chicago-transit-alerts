import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { computeCohortDurationStats } from '../lib/aggregate.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import {
  chicagoDayUTC,
  formatChicagoDay,
  formatDate,
  formatDuration,
  formatEstimatedEnd,
  formatStabilizationDelta,
  formatTime,
  hexToRgba,
} from '../lib/format.js';
import {
  affectedLineSegments,
  findContemporaneousOnOtherLines,
  findIncidentById,
  findRelatedIncidents,
  flattenIncidents,
  formatEvidenceChip,
  formatRoutesLabel,
  mergeMatchingIncidents,
  SIGNAL_LABELS,
  splitObservations,
} from '../lib/incidents.js';
import {
  buildStationIndex,
  displayStationName,
  linesServingStation,
  slugifyStation,
  stationsServingLines,
} from '../lib/stations.js';
import BrowseMenu from './BrowseMenu.jsx';
import EventMap from './EventMap.jsx';
import LinePill from './LinePill.jsx';
import MultiLineEventMap from './MultiLineEventMap.jsx';
import NotFoundPage from './NotFoundPage.jsx';
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
//
// When the incident affects multiple routes, counts are kept *per route* so
// the renderer can draw one row per affected line. Collapsing into a single
// row paints "any of these routes had an incident" with one color, which
// misrepresents alerts that touch the lines unevenly (e.g. Pink+Green where
// only Pink had prior days of trouble).
function buildEventLineWindow(incident, incidents, numDays = 14, now = Date.now()) {
  const routes = incidentRoutes(incident);
  const kind = incident.kind;
  const startTs = incident.first_seen_ts ?? incident.ts;
  if (routes.length === 0 || startTs == null) return null;
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

  const dayUtcs = [];
  for (let i = 0; i < numDays; i++) dayUtcs.push(startDay + i * DAY_MS);

  // perRoute[route] = number[] aligned to dayUtcs.
  const perRoute = Object.fromEntries(routes.map((r) => [r, new Array(numDays).fill(0)]));
  const routeSet = new Set(routes);

  function bump(ts, incRoutes, incKind) {
    if (incKind !== kind) return;
    const dayUtc = chicagoDayUTC(ts);
    const idx = Math.round((dayUtc - startDay) / DAY_MS);
    if (idx < 0 || idx >= numDays) return;
    for (const r of incRoutes) {
      if (routeSet.has(r)) perRoute[r][idx] += 1;
    }
  }
  for (const inc of incidents || []) bump(inc.first_seen_ts, inc.routes || [], inc.kind);

  return { dayUtcs, perRoute, routes, centerDayUtc };
}

// Color picker for a single route's cell. Train routes get their brand color;
// bus routes share the slate tint Timeline uses for the bus row.
function routeColor(kind, route) {
  if (kind === 'train') {
    const info = TRAIN_LINES[route];
    if (info) return info.color;
  }
  return BUS_COLOR;
}

// Compact pill label for the row gutter — just the line name, no link. The
// EventDetail card above already has linked LinePills for navigation; here
// the pill is purely a legend so the reader can match row to color.
function RowLabel({ kind, route }) {
  if (kind === 'train') {
    const info = TRAIN_LINES[route];
    if (info) {
      return (
        <span
          className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
          style={{ backgroundColor: info.color, color: info.textColor }}
        >
          {info.label}
        </span>
      );
    }
  }
  return (
    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-slate-700 text-white">
      {kind === 'bus' ? `#${route}` : route}
    </span>
  );
}

// Cell opacity ramp for the count heatmap. Absolute (not relative to the
// window's max) so the same count always paints the same shade across events.
// Saturates at 5+ because the printed number disambiguates anything denser.
function cellOpacity(count) {
  if (count <= 0) return 0;
  if (count === 1) return 0.3;
  if (count === 2) return 0.5;
  if (count === 3) return 0.7;
  if (count === 4) return 0.85;
  return 1;
}

// Pick black/white for the count label by the cell's *perceived* luminance —
// the brand color blended over the current theme's page background at the
// cell's opacity. A fixed text color can't work: cells run from a pale tint
// (count 2) to full saturation (count 5), and dark mode inverts the blend.
function cellTextColor(hex, opacity, dark) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Page background per theme: #ffffff (light) / #21262d gh-canvas (dark).
  const [br, bg, bb] = dark ? [33, 38, 45] : [255, 255, 255];
  const mix = (c, base) => c * opacity + base * (1 - opacity);
  const lum = 0.299 * mix(r, br) + 0.587 * mix(g, bg) + 0.114 * mix(b, bb);
  return lum > 150 ? '#000' : '#fff';
}

// One day = one square cell, shaded by incident count (darker = more) and
// stamped with the exact count when it's 2+. Single-incident and empty days
// stay unlabeled so the row reads as a heatmap with numbers only where the
// magnitude is worth spelling out.
function TimelineRow({ counts, dayUtcs, centerDayUtc, color, dark }) {
  return (
    <div
      className="grid gap-1 flex-1 min-w-0"
      style={{ gridTemplateColumns: `repeat(${dayUtcs.length}, minmax(0, 1fr))` }}
    >
      {dayUtcs.map((dayUtc, i) => {
        const count = counts[i];
        const isPinned = dayUtc === centerDayUtc;
        const label = `${formatChicagoDay(dayUtc)}: ${count} incident${count === 1 ? '' : 's'}`;
        const opacity = cellOpacity(count);
        return (
          <div
            key={dayUtc}
            title={label}
            className={`aspect-square rounded-sm flex items-center justify-center text-[11px] font-bold leading-none ${
              isPinned ? 'ring-1 ring-slate-700 dark:ring-slate-200' : ''
            }`}
            style={{
              backgroundColor: count > 0 ? hexToRgba(color, opacity) : 'var(--timeline-empty)',
            }}
          >
            {count >= 2 && (
              <span style={{ color: cellTextColor(color, opacity, dark) }}>{count}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniTimeline({ incident, incidents, dark }) {
  const windowData = useMemo(
    () => buildEventLineWindow(incident, incidents),
    [incident, incidents],
  );
  if (!windowData) return null;
  const { dayUtcs, perRoute, routes, centerDayUtc } = windowData;
  const multi = routes.length > 1;

  // Short month/day labels for the range endpoints. The full formatDate
  // ("Apr 24, 2026") is overkill at 14-day scale and crowds the row, but the
  // year is needed when the range straddles a year boundary so a Dec→Jan
  // window doesn't read as 2026 → 2026.
  const firstDay = dayUtcs[0];
  const lastDay = dayUtcs[dayUtcs.length - 1];
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
        Surrounding {dayUtcs.length} days on {formatRoutesLabel(incident.kind, routes)}
      </p>
      {multi ? (
        // Stacked rows: one per route. A fixed-width label column keeps every
        // row's grid aligned so cells stack vertically by day.
        <div className="space-y-1">
          {routes.map((route) => (
            <div key={route} className="flex items-center gap-2">
              <div className="w-12 flex-shrink-0 flex justify-end">
                <RowLabel kind={incident.kind} route={route} />
              </div>
              <TimelineRow
                counts={perRoute[route]}
                dayUtcs={dayUtcs}
                centerDayUtc={centerDayUtc}
                color={routeColor(incident.kind, route)}
                dark={dark}
              />
            </div>
          ))}
          <div className="flex">
            <div className="w-12 flex-shrink-0" />
            <div className="flex-1 flex justify-between mt-1.5 text-xs text-slate-400 dark:text-slate-500 tabular-nums">
              <span>{firstLabel}</span>
              <span>{lastLabel}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <TimelineRow
            counts={perRoute[routes[0]]}
            dayUtcs={dayUtcs}
            centerDayUtc={centerDayUtc}
            color={routeColor(incident.kind, routes[0])}
            dark={dark}
          />
          <div className="flex justify-between mt-1.5 text-xs text-slate-400 dark:text-slate-500 tabular-nums">
            <span>{firstLabel}</span>
            <span>{lastLabel}</span>
          </div>
        </>
      )}
    </div>
  );
}

function relatedDescription(incident, stationIndex) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    return (
      <>
        <StationName name={primary.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={primary.to_station} stationIndex={stationIndex} />
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
          <p className="text-xs text-slate-400 dark:text-slate-500">{formatTime(ts)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {showLinePill && <LinePill kind={other.kind} routes={other.routes} />}
            {otherIsMerged && (
              <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                via CTA + auto-detection
              </span>
            )}
            {!otherIsMerged && otherIsAlert && (
              <span className="text-xs text-slate-400 dark:text-slate-500 italic">via CTA</span>
            )}
            {!otherIsMerged && !otherIsAlert && (
              <span className="text-xs text-slate-400 dark:text-slate-500 italic">
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
function CrossLineContext({ incident, incidents, stationIndex }) {
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

function RelatedIncidents({ incident, incidents, stationIndex }) {
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

// Plain-string variant of `describe` for places that can't render JSX —
// document.title, plain text logging, etc.
function describeText(incident) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    return `${displayStationName(primary.from_station)} → ${displayStationName(primary.to_station)}`;
  }
  if (primary?.detection_source === 'roundup' && primary.signals?.length > 0) {
    return `Multiple signals: ${primary.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (primary?.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  return 'Service disruption detected';
}

function describe(incident, stationIndex) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    return (
      <>
        <StationName name={primary.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={primary.to_station} stationIndex={stationIndex} />
      </>
    );
  }
  if (primary?.detection_source === 'roundup' && primary.signals?.length > 0) {
    return `Multiple signals: ${primary.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (primary?.detection_source === 'roundup') {
    return 'Multiple simultaneous disruptions detected';
  }
  return 'Service disruption detected';
}

export default function EventPage({ eventId }) {
  const [dark, toggleDark] = useDarkMode();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Initial fetch + 5-minute poll. Matches App.jsx's cadence so an event
  // page left open on an active incident updates its duration / "ongoing"
  // chip / resolution status without a reload. Only the initial fetch
  // surfaces a hard error — silent failures after that keep the existing
  // data visible rather than yanking the page out from under the reader.
  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}data/alerts.json`;

    function fetchData() {
      fetch(url, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((fresh) => {
          setData((prev) => {
            if (!prev || fresh.generated_at !== prev.generated_at) return fresh;
            return prev;
          });
        })
        .catch((err) => {
          setData((prev) => {
            if (!prev) setError(err);
            return prev;
          });
        });
    }

    fetchData();
    const id = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const incident = useMemo(() => {
    if (!data) return null;
    return findIncidentById(data.incidents, eventId);
  }, [data, eventId]);

  // Flat { alerts, observations } view of the payload — the station index and
  // BrowseMenu (and, via EventDetail, the cohort stats) still read the flat
  // shape. The view itself renders the nested `incident` directly.
  const flat = useMemo(() => (data ? flattenIncidents(data.incidents) : null), [data]);

  const stationIndex = useMemo(() => {
    if (!flat) return null;
    return buildStationIndex(flat.alerts, flat.observations, { windowDays: 90 });
  }, [flat]);

  // Set the tab title from the incident so bookmarks and shared links land in
  // browser history with something readable, not the generic site title.
  useEffect(() => {
    const base = 'Chicago Transit Alerts';
    if (!incident) {
      document.title = base;
      return;
    }
    // Prefix the tab title with the route label so a generic CTA headline
    // (e.g. "Temporary Reroute") doesn't lose the route context the rest of
    // the page makes obvious.
    const label = formatRoutesLabel(incident.kind, incidentRoutes(incident));
    const desc = describeText(incident);
    document.title = `${label} · ${desc} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [incident]);

  if (data && !incident) {
    return <NotFoundPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <main className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        <div className="flex items-center justify-between mb-4">
          <a href="/" className="text-sm text-blue-500 hover:text-blue-400 hover:underline">
            ← Back to all incidents
          </a>
          <div className="flex items-center gap-2">
            <BrowseMenu alerts={flat?.alerts} observations={flat?.observations} />
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

        {incident && (
          <>
            <EventDetail
              incident={incident}
              incidents={data.incidents}
              alerts={flat.alerts}
              observations={flat.observations}
              stationIndex={stationIndex}
              dark={dark}
            />
            <RelatedIncidents
              incident={incident}
              incidents={data.incidents}
              stationIndex={stationIndex}
            />
            <CrossLineContext
              incident={incident}
              incidents={data.incidents}
              stationIndex={stationIndex}
            />
          </>
        )}
      </main>
    </div>
  );
}

// Pull both alert-side (affected_*) and observation-side (from/to) station
// names off an incident into a single ordered, deduped list. Keeps the
// callout self-contained — formerly the alert's affected_* line and the
// merged record's observation from/to displayed in two different places,
// neither truly chip-styled.
// Wrap each mention of a known station in the alert text with a StationName
// component so the same dotted-underline that links bot observations also
// links the inline names in CTA's own description ("delays at Monroe" →
// "delays at <link>Monroe</link>"). Match against the canonical names in
// `mentions` (already line-scoped upstream so "Halsted" doesn't bleed across
// lines) plus their base form (without the parenthetical disambiguator),
// since CTA writes "Monroe" not "Monroe (Red)". Longest-first scan prevents
// "UIC" from matching inside "UIC-Halsted". Whole-word boundaries on either
// side keep "Howard" from matching inside "Howards" or station-suffix tokens.
function linkifyMentionedStations(text, mentions, stationIndex) {
  if (!text) return text;
  // No aliases to match → return text as-is. Without this short-circuit,
  // the alternation below becomes `(?:)`, which matches the empty string
  // at every position and produces 2N entries in `parts` for a text of
  // length N — fast in isolation, but multiplied across every render of a
  // bus alert (which never has mentioned_stations and whose
  // stationsServingLines pool is empty) it blew the vitest worker's heap.
  if (!mentions || mentions.length === 0) return text;
  // Pair each canonical name with its display alias(es) that might appear in
  // the text. Display form (no parenthetical) is what CTA writes; canonical
  // form is what we link to. Same canonical can have one or both forms.
  const aliases = [];
  // Dedupe across the upstream-extracted mentions and any roster-derived
  // additions so the same canonical doesn't appear twice in the alias pool.
  const seenCanonical = new Set();
  for (const canonical of mentions || []) {
    if (seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);
    const display = displayStationName(canonical);
    aliases.push({ alias: canonical, canonical });
    if (display && display !== canonical) {
      aliases.push({ alias: display, canonical });
    }
  }
  // Longest-first so substring aliases ("Halsted") don't shadow longer ones
  // ("UIC-Halsted") that share a prefix.
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  // Slash and hyphen handling: CTA sometimes writes "Adams/ Wabash" or
  // "UIC Halsted" where the canonical name uses "Adams/Wabash" or
  // "UIC-Halsted". Build a regex per alias that tolerates whitespace
  // around slashes and treats `-`/space as interchangeable.
  function aliasPattern(alias) {
    return (
      alias
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // CTA writes "Adams/ Wabash" with a stray space; the canonical name is
        // "Adams/Wabash". Allow whitespace around any `/` in the alias.
        .replace(/\//g, '\\s*/\\s*')
        // Hyphens and runs of whitespace are interchangeable: canonical
        // "UIC-Halsted" matches CTA's "UIC Halsted".
        .replace(/[\s-]+/g, '[\\s-]+')
    );
  }
  // Suffix denylist: short single-word station names like "Chicago" or
  // "Loop" collide with geographic features ("Chicago River", "Chicago
  // Avenue") and neighborhood phrasing ("Loop area"). When the match is
  // immediately followed by one of these tokens it's a place name in the
  // alert text, not a station reference, so we skip the link.
  const NON_STATION_SUFFIX =
    '(?:River|Bridge|Avenue|Ave|Street|St|Boulevard|Blvd|Road|Rd|Drive|Dr|Expressway|Expy|area|neighborhood|Heights)';
  const combined = new RegExp(
    `(?<![A-Za-z0-9])(?:${aliases.map((a) => aliasPattern(a.alias)).join('|')})(?![A-Za-z0-9])(?!\\s+${NON_STATION_SUFFIX}\\b)`,
    'g',
  );
  const parts = [];
  let cursor = 0;
  let m = combined.exec(text);
  while (m !== null) {
    if (m.index > cursor) parts.push(text.slice(cursor, m.index));
    // Re-match the captured chunk against each alias to recover the
    // canonical name — alias order isn't preserved in the alternation match.
    const matched = m[0];
    let canonical = null;
    for (const a of aliases) {
      if (new RegExp(`^${aliasPattern(a.alias)}$`).test(matched)) {
        canonical = a.canonical;
        break;
      }
    }
    parts.push(
      <StationName
        key={`${m.index}-${matched}`}
        name={canonical ?? matched}
        stationIndex={stationIndex}
      />,
    );
    cursor = m.index + matched.length;
    m = combined.exec(text);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

function collectAffectedStations(incident) {
  const cta = incident.cta;
  const { primary, extras } = splitObservations(incident);
  const seen = new Set();
  const out = [];
  function add(name) {
    if (!name) return;
    const key = name.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  }
  add(cta?.affected_from_station);
  add(cta?.affected_to_station);
  add(primary?.from_station);
  add(primary?.to_station);
  // Every merged observation's endpoints, not just the primary's. A Loop-wide
  // alert merges one pulse-cold detection per affected line; showing only the
  // primary obs's segment (e.g. "Armitage ↔ Chicago") misrepresents a
  // five-line incident as a single stretch on one line.
  for (const e of extras) {
    add(e.from_station);
    add(e.to_station);
  }
  // mentioned_stations carries impact-context matches the upstream extractor
  // pulled from the alert text ("delays at Monroe"). Include after the
  // segment endpoints so the canonical "from → to" still renders first when
  // both are present; the dedupe keeps overlap from doubling up.
  for (const name of cta?.mentioned_stations || []) add(name);
  // Upstream sometimes carries both a bare name (e.g. "Garfield" from the
  // headline) and its fully qualified counterpart ("Garfield (Green)" from
  // the extracted mentions) for the same physical station. Drop the bare
  // entry when a qualified version of the same display name exists — it's
  // the same station, just less disambiguated. Distinct qualified entries
  // ("Garfield (Red)" + "Garfield (Green)") stay, since those are two
  // physically different stations.
  const QUALIFIER = /\s*\([^)]*\)\s*$/;
  const qualifiedDisplays = new Set();
  for (const name of out) {
    if (QUALIFIER.test(name)) qualifiedDisplays.add(displayStationName(name).toLowerCase());
  }
  return out.filter((name) => {
    if (QUALIFIER.test(name)) return true;
    return !qualifiedDisplays.has(name.toLowerCase());
  });
}

// Group an incident's affected stretches by line, for the per-line station
// list on multi-line incidents. Mirrors the multi-line map: each merged
// observation contributes a segment on its own line. Returns null when no
// segment owns a line (a pure CTA alert applies to all its routes at once,
// so there's nothing to split by — the flat chips are clearer there).
function groupAffectedStationsByLine(segments) {
  const segs = segments.filter((s) => s.line);
  if (segs.length === 0) return null;
  const byLine = new Map();
  for (const s of segs) {
    let list = byLine.get(s.line);
    if (!list) {
      list = [];
      byLine.set(s.line, list);
    }
    list.push({ from: s.from, to: s.to });
  }
  return [...byLine.entries()]
    .sort((a, b) => TRAIN_LINE_ORDER.indexOf(a[0]) - TRAIN_LINE_ORDER.indexOf(b[0]))
    .map(([line, segments]) => ({ line, segments }));
}

// Spread a bot's single-line stretch onto the OTHER affected lines that share
// the same trackage. The bot scopes a pulse-cold to one line ('pink'), but on
// shared track (the Lake St elevated, the Loop, Red+Purple north of Belmont)
// the same stations carry several lines — and the CTA alert that scopes the
// incident to `routes` confirms those other lines are down too. So for each
// line-owned segment, we add a copy on every other incident route that the
// roster says serves BOTH endpoints. Returns the augmented segment list plus
// `expanded`: whether any inferred copy was actually added (drives the copy
// that tells the reader these rows are shared-trackage, not separate bot hits).
//
// Line-agnostic segments (alert-level, `line: null`) pass through untouched —
// the map already fans those out to every serving line on its own.
function expandSharedTrackageSegments(segments, routes) {
  const others = (routes || []).filter(Boolean);
  if (others.length < 2) return { segments: segments || [], expanded: false };
  const out = [];
  const seen = new Set();
  const push = (seg) => {
    const key = `${seg.line ?? ''}|${seg.from ?? ''}|${seg.to ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(seg);
  };
  let expanded = false;
  for (const seg of segments || []) {
    push(seg);
    // Only a line-owned stretch with both endpoints can be projected onto a
    // sibling line — we need both stations to confirm the sibling serves the
    // whole run, not just one end.
    if (!seg.line || !seg.from || !seg.to) continue;
    const fromLines = new Set(linesServingStation(seg.from));
    const toLines = new Set(linesServingStation(seg.to));
    for (const r of others) {
      if (r === seg.line) continue;
      if (fromLines.has(r) && toLines.has(r)) {
        const before = seen.size;
        push({ line: r, from: seg.from, to: seg.to });
        if (seen.size > before) expanded = true;
      }
    }
  }
  return { segments: out, expanded };
}

// Quiet inline row of affected station links. No chunky pills — the line
// pill above already carries the brand color, so loud per-station chips
// just compete with it. These are supplementary navigation: dotted-
// underline links that match the rest of the site's station-name style.
// Caller decides whether to render at all (only useful when the headline
// doesn't already spell the stations out — see EventDetail).
function StationChips({ stations, direction }) {
  if (!stations || stations.length === 0) return null;
  // For two-station segments, `→` reads as "one direction only". Most alerts
  // affect both directions (direction is null) — render `↔` there so the
  // glyph matches reality. When upstream actually carries a direction
  // ("Northbound only"), keep the one-way arrow.
  const segmentGlyph = direction ? '→' : '↔';
  // Two distinct stations (e.g. Garfield Red vs Garfield Green) collapse to
  // the same displayStationName, so show the raw qualifier-bearing name for
  // any station whose stripped label collides with another in this list.
  const displayCounts = new Map();
  for (const name of stations) {
    const d = displayStationName(name);
    displayCounts.set(d, (displayCounts.get(d) || 0) + 1);
  }
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
        Stations
      </span>
      {stations.map((name, i) => {
        const slug = slugifyStation(name);
        const stripped = displayStationName(name);
        const display = displayCounts.get(stripped) > 1 ? name : stripped;
        const isLast = i === stations.length - 1;
        const link = slug ? (
          <a
            href={`/station/${slug}`}
            className="underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-[3px] hover:decoration-solid hover:decoration-blue-500 hover:text-blue-500"
          >
            {display}
          </a>
        ) : (
          <span>{display}</span>
        );
        return (
          <span key={name} className="inline-flex items-center gap-1.5">
            {link}
            {!isLast && stations.length === 2 && (
              <span className="text-slate-400 dark:text-slate-500">{segmentGlyph}</span>
            )}
            {!isLast && stations.length !== 2 && (
              <span className="text-slate-300 dark:text-slate-600">·</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

// Single station as a dotted-underline link to its page, matching the style
// StationChips uses. Falls back to plain text when the name doesn't slugify.
function StationLink({ name }) {
  if (!name) return null;
  const slug = slugifyStation(name);
  const display = displayStationName(name);
  if (!slug) return <span>{display}</span>;
  return (
    <a
      href={`/station/${slug}`}
      className="underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-[3px] hover:decoration-solid hover:decoration-blue-500 hover:text-blue-500"
    >
      {display}
    </a>
  );
}

// Per-line affected stations for multi-line incidents. Each row pairs the
// line's brand-color pill with its affected stretch(es), so the list reads
// the same way the multi-line map does ("Brown: Armitage ↔ Chicago") instead
// of one flat run of names that hides which station sits on which line.
function StationsByLine({ groups, direction, sharedTrackage = false }) {
  if (!groups || groups.length === 0) return null;
  // Most alerts hit both directions (direction null) — `↔` matches that;
  // a one-way alert keeps the directional arrow.
  const glyph = direction ? '→' : '↔';
  // When the rows were fanned out across shared trackage, the bot only fired on
  // one of them — the rest are inferred from the CTA's line scope + the roster.
  // Say "affected" (not "bot observed") and note the shared-track inference so
  // the duplicate stretches don't read as separate detections.
  return (
    <div className="mt-1">
      <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {sharedTrackage ? 'Affected stations (shared trackage)' : 'Bot observed impacted stations'}
      </span>
      <div className="mt-1 space-y-1">
        {groups.map(({ line, segments }) => (
          // Fixed-width pill column so every line's stations start at the same
          // x — the pills vary in width (Brown vs Orange vs Purple), which
          // otherwise left the station names ragged. items-center vertically
          // centers the station text against its line pill.
          <div key={line} className="flex items-center gap-2">
            <div className="w-16 flex-shrink-0">
              <RowLabel kind="train" route={line} />
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-600 dark:text-slate-300">
              {segments.map((seg, si) => (
                <span
                  key={`${seg.from ?? ''}→${seg.to ?? ''}`}
                  className="inline-flex items-center gap-1.5"
                >
                  {si > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
                  <StationLink name={seg.from} />
                  {seg.from && seg.to && (
                    <span className="text-slate-400 dark:text-slate-500">{glyph}</span>
                  )}
                  <StationLink name={seg.to} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
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
        <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
      <div className="flex justify-between mt-1 text-xs text-slate-400 dark:text-slate-500 tabular-nums">
        <span>0</span>
        <span>median {formatDuration(stats.medianMs)}</span>
        <span>p90 {formatDuration(stats.p90Ms)}</span>
      </div>
    </div>
  );
}

function EventDetail({ incident, incidents, alerts, observations, stationIndex, dark }) {
  const cta = incident.cta;
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

  // CTA-planned-start callout. When CTA tagged the alert with an EventStart
  // that meaningfully predates our first sighting, the disruption was a
  // planned event scheduled in advance rather than a live reactive post.
  // Skipped when the gap is < 10 minutes (CTA fired effectively in real
  // time) or > 14 days (a stale EventStart from a long-running planned
  // alert isn't informative).
  let ctaPlannedPhrase = null;
  const ctaStart = cta?.cta_event_start_ts ?? null;
  if (ctaStart != null && startTs != null) {
    const aheadMs = startTs - ctaStart;
    const TEN_MIN = 10 * 60 * 1000;
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
    if (aheadMs >= TEN_MIN && aheadMs <= FOURTEEN_DAYS) {
      const aheadMin = Math.round(aheadMs / 60_000);
      if (aheadMin < 60) ctaPlannedPhrase = `${aheadMin} min ahead`;
      else if (aheadMin < 24 * 60) {
        const h = Math.floor(aheadMin / 60);
        const m = aheadMin % 60;
        ctaPlannedPhrase = m > 0 ? `${h}h ${m}m ahead` : `${h}h ahead`;
      } else {
        const d = Math.floor(aheadMin / (24 * 60));
        const hours = Math.round((aheadMin - d * 24 * 60) / 60);
        ctaPlannedPhrase = hours > 0 ? `${d}d ${hours}h ahead` : `${d}d ahead`;
      }
    }
  }

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

  let ctaEstimateBlock = null;
  const ctaEnd = cta?.cta_event_end_ts ?? null;
  // The retrospective "X min early/late" comparison is only meaningful when
  // CTA posted a time. Date-only EventEnd ("through May 25") has no minute
  // precision to compare against, so we skip the early/late framing in that
  // case and just show the date as context.
  if (ctaEnd != null && incident.resolved_ts != null && !ctaEndIsDateOnly) {
    const deltaMs = incident.resolved_ts - ctaEnd;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (Math.abs(deltaMs) <= WEEK_MS) {
      const absMin = Math.round(Math.abs(deltaMs) / 60_000);
      const sameMinute = absMin === 0;
      const earlyLate = deltaMs > 0 ? 'late' : 'early';
      const minPhrase =
        absMin < 60
          ? `${absMin} min`
          : `${Math.floor(absMin / 60)}h${absMin % 60 ? ` ${absMin % 60}m` : ''}`;
      ctaEstimateBlock = {
        sameMinute,
        phrase: sameMinute ? 'cleared right on schedule' : `${minPhrase} ${earlyLate}`,
      };
    }
  }

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
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">via CTA</span>
            <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">
              via auto-detection
            </span>
          </>
        )}
        {isAlert && (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">via CTA</span>
        )}
        {isObsOnly && (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">
            via auto-detection
          </span>
        )}
        {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
        {!incident.active && incident.resolved_ts != null && (
          <span className="text-xs font-semibold text-green-600 dark:text-green-400">resolved</span>
        )}
      </div>

      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-2">
        {description}
      </h1>

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
        incident.kind !== 'bus' &&
        (stationsByLine ? (
          <StationsByLine
            groups={stationsByLine}
            direction={cta.affected_direction}
            sharedTrackage={sharedTrackage}
          />
        ) : (
          <StationChips stations={affectedStations} direction={cta.affected_direction} />
        ))}

      {isObsOnly && primary?.signals?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
            <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
          <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-2">
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
        if (!detection) return null;
        const joinBullets = (items) => items.map((b) => b.replace(/\.\s*$/, '')).join('; ') + '.';
        const bulletsBlock =
          Array.isArray(bullets) && bullets.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {joinBullets(bullets)}
            </p>
          ) : null;
        if (!resolution) {
          return (
            <blockquote className="mt-4 border-l-2 border-slate-300 dark:border-gh-border pl-4 py-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                Per bot
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {detection}
              </p>
              {bulletsBlock}
            </blockquote>
          );
        }
        // Two entries: resolution (latest) at top, detection (oldest) below.
        // Matches the visual rhythm of the multi-version CTA block above.
        // Bullets only belong on the detection entry — the resolution post is
        // a single "back to normal" sentence with no per-signal detail.
        const entries = [
          { ts: incident.resolved_ts, text: resolution, isLatest: true, isOldest: false },
          { ts: primary.ts, text: detection, isLatest: false, isOldest: true, bullets },
        ];
        return (
          <section className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Per bot · 2 updates
            </p>
            <ol className="space-y-6">
              {entries.map((e) => (
                <li key={e.ts} className="relative pl-6">
                  {!e.isOldest && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[3px] top-2 w-px bg-slate-200 dark:bg-gh-border"
                      style={{ bottom: '-1.5rem' }}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1.5 w-[7px] h-[7px] rounded-full ring-2 ring-white dark:ring-gh-surface ${
                      e.isLatest ? 'bg-blue-500' : 'bg-slate-400 dark:bg-slate-500'
                    }`}
                  />
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatDate(e.ts)} · {formatTime(e.ts)}
                    </p>
                    {e.isLatest && (
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
              ))}
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
        const hasResolved = !incident.active && incident.resolved_ts != null;
        const entries = [...versions]
          .sort((a, b) => b.ts - a.ts)
          .map((v) => ({ type: 'version', ...v }));
        if (hasResolved && versions.length > 0) {
          entries.unshift({ type: 'cleared', ts: incident.resolved_ts });
        }
        if (entries.length === 0) return null;

        // A single CTA message with no clear yet stays a simple quote block.
        if (entries.length === 1) {
          const v = entries[0];
          if (!v.short_description) return null;
          return (
            <blockquote className="mt-4 border-l-2 border-slate-300 dark:border-gh-border pl-4 py-1">
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                Per CTA
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                {linkifyMentionedStations(v.short_description, linkPool, stationIndex)}
              </p>
            </blockquote>
          );
        }

        return (
          <section className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Per CTA · {entries.length} updates
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
                // Headline only re-shown when it changed from the next OLDER
                // version (skip the clear entry, which carries no headline).
                // Most edits keep the headline and only revise the body, so
                // reprinting it on every entry would be noise.
                const prevVersion = entries.slice(i + 1).find((x) => x.type === 'version');
                const showHeadline =
                  !isCleared && (!prevVersion || prevVersion.headline !== e.headline);
                return (
                  <li key={`${e.type}-${e.ts}`} className="relative pl-6">
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
                      {isLatest && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-500">
                          Latest
                        </span>
                      )}
                    </div>
                    {isCleared ? (
                      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        CTA cleared this alert.
                      </p>
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
        {ctaPlannedPhrase && (
          <div
            className="sm:col-span-2"
            title="CTA's EventStart predates our first sighting — the alert was planned in advance rather than fired live."
          >
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              CTA scheduled
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              <strong>{ctaPlannedPhrase}</strong> of the first sighting{' '}
              <span className="text-slate-400 dark:text-slate-500 text-xs">
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
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              CTA estimated end
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {ctaEndIsDateOnly ? (
                <>
                  <strong>{formatDate(ctaEnd)}</strong>
                  {showRelativeParenthetical && (
                    <>
                      {' '}
                      <span className="text-slate-400 dark:text-slate-500 text-xs">
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
                      <span className="text-slate-400 dark:text-slate-500 text-xs">
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
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              vs CTA's stated end
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {ctaEstimateBlock.phrase}{' '}
              <span className="text-slate-400 dark:text-slate-500 text-xs">
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
            <dt className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Service stabilized
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">
              {stabilizationDelta} after CTA cleared the alert
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

      <DurationScale stats={cohortStats} />

      <MiniTimeline incident={incident} incidents={incidents} dark={dark} />

      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-gh-border">
        <ShareLink eventId={eventId} title={description} />
        {primaryUrl && (
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
          >
            {isMerged ? 'Via CTA →' : 'View on Bluesky →'}
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
