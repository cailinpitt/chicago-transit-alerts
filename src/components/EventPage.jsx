import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { computeCohortDurationStats } from '../lib/aggregate.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
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
  findContemporaneousOnOtherLines,
  findIncidentById,
  findRelatedIncidents,
  formatEvidenceChip,
  formatRoutesLabel,
  getEventId,
  mergeMatchingIncidents,
  normalizeAlertsPayload,
  SIGNAL_LABELS,
} from '../lib/incidents.js';
import {
  buildStationIndex,
  displayStationName,
  slugifyStation,
  stationsServingLines,
} from '../lib/stations.js';
import BrowseMenu from './BrowseMenu.jsx';
import EventMap from './EventMap.jsx';
import LinePill from './LinePill.jsx';
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
function buildEventLineWindow(incident, alerts, observations, numDays = 14, now = Date.now()) {
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

  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);
  function bump(ts, incRoutes, incKind) {
    if (incKind !== kind) return;
    const dayUtc = chicagoDayUTC(ts);
    const idx = Math.round((dayUtc - startDay) / DAY_MS);
    if (idx < 0 || idx >= numDays) return;
    for (const r of incRoutes) {
      if (routeSet.has(r)) perRoute[r][idx] += 1;
    }
  }
  for (const m of merged) bump(m.first_seen_ts, m.routes || [], m.kind);
  for (const a of standaloneAlerts) bump(a.first_seen_ts, a.routes || [], a.kind);
  for (const o of standaloneObs) bump(o.first_seen_ts ?? o.ts, [o.line], o.kind);

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

function TimelineRow({ counts, dayUtcs, centerDayUtc, color }) {
  function cellBg(count) {
    if (count === 0) return 'var(--timeline-empty)';
    if (count === 1) return hexToRgba(color, 0.4);
    return color;
  }
  return (
    <div
      className="grid gap-1 flex-1 min-w-0"
      style={{ gridTemplateColumns: `repeat(${dayUtcs.length}, minmax(0, 1fr))` }}
    >
      {dayUtcs.map((dayUtc, i) => {
        const count = counts[i];
        const isPinned = dayUtc === centerDayUtc;
        const label = `${formatChicagoDay(dayUtc)}: ${count} incident${count === 1 ? '' : 's'}`;
        return (
          <div
            key={dayUtc}
            title={label}
            className={`aspect-square rounded-sm ${
              isPinned ? 'ring-1 ring-slate-700 dark:ring-slate-200' : ''
            }`}
            style={{ backgroundColor: cellBg(count) }}
          />
        );
      })}
    </div>
  );
}

function MiniTimeline({ incident, alerts, observations }) {
  const windowData = useMemo(
    () => buildEventLineWindow(incident, alerts, observations),
    [incident, alerts, observations],
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
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return (
      <>
        <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={incident.to_station} stationIndex={stationIndex} />
      </>
    );
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') return 'Multiple simultaneous disruptions';
  return 'Service disruption detected';
}

// Contemporaneous activity on OTHER lines/routes within ±1h of this event.
// Companion to RelatedIncidents (which stays scoped to the same line) so a
// reader can tell at a glance whether this disruption sat alongside others
// across the system — a strong hint of a shared root cause (weather, power,
// big-event letout) vs. an isolated incident.
//
// Renders nothing when the time-adjacent window is empty. The window is
// tighter than RelatedIncidents (1h vs 24h) on purpose: cross-line
// causation is meaningful at hour-scale, not day-scale; widening it would
// dilute the signal into "things that happened today".
function CrossLineContext({ incident, alerts, observations, stationIndex }) {
  const others = useMemo(
    () => findContemporaneousOnOtherLines(incident, alerts, observations),
    [incident, alerts, observations],
  );
  if (others.length === 0) return null;
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Elsewhere on the system (±1h)
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
        {others.map((other) => {
          const ts = other.first_seen_ts ?? other.ts;
          const otherIsMerged = other._type === 'merged';
          const otherIsAlert = !otherIsMerged && !!other.alert_id;
          const eventId = other.alert_id ?? `obs-${other.id ?? other.obs_id ?? ts}`;
          const detailsId = getEventId(other);
          return (
            <div key={eventId} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-shrink-0 w-20 text-right">
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(ts)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatTime(ts)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <LinePill kind={other.kind} line={other.line} routes={other.routes} />
                  {otherIsMerged && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA + auto-detection
                    </span>
                  )}
                  {!otherIsMerged && otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA
                    </span>
                  )}
                  {!otherIsMerged && !otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via auto-detection
                    </span>
                  )}
                  {other.active && (
                    <span className="text-xs font-semibold text-red-500">ongoing</span>
                  )}
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
          );
        })}
      </div>
    </section>
  );
}

function RelatedIncidents({ incident, alerts, observations, stationIndex }) {
  const related = useMemo(
    () => findRelatedIncidents(incident, alerts, observations),
    [incident, alerts, observations],
  );
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
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border divide-y divide-slate-100 dark:divide-gh-border">
        {related.map((other) => {
          const ts = other.first_seen_ts ?? other.ts;
          const otherIsMerged = other._type === 'merged';
          const otherIsAlert = !otherIsMerged && !!other.alert_id;
          const eventId = other.alert_id ? other.alert_id : `obs-${other.id ?? other.obs_id ?? ts}`;
          return (
            <div key={eventId} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-shrink-0 w-20 text-right">
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(ts)}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatTime(ts)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {otherIsMerged && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA + auto-detection
                    </span>
                  )}
                  {!otherIsMerged && otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via CTA
                    </span>
                  )}
                  {!otherIsMerged && !otherIsAlert && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                      via auto-detection
                    </span>
                  )}
                  {other.active && (
                    <span className="text-xs font-semibold text-red-500">ongoing</span>
                  )}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
                  {relatedDescription(other, stationIndex)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Plain-string variant of `describe` for places that can't render JSX —
// document.title, plain text logging, etc.
function describeText(incident, isMerged, isAlert) {
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return `${displayStationName(incident.from_station)} → ${displayStationName(incident.to_station)}`;
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  return 'Service disruption detected';
}

function describe(incident, isMerged, isAlert, stationIndex) {
  if (isMerged || isAlert) return incident.headline;
  if (incident.from_station && incident.to_station) {
    return (
      <>
        <StationName name={incident.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={incident.to_station} stationIndex={stationIndex} />
      </>
    );
  }
  if (incident.detection_source === 'roundup' && incident.signals?.length > 0) {
    return `Multiple signals: ${incident.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')}`;
  }
  if (incident.detection_source === 'roundup') {
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
        .then((raw) => {
          const fresh = normalizeAlertsPayload(raw);
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
    return findIncidentById(data.alerts, data.observations, eventId);
  }, [data, eventId]);

  const stationIndex = useMemo(() => {
    if (!data) return null;
    return buildStationIndex(data.alerts, data.observations, { windowDays: 90 });
  }, [data]);

  // Set the tab title from the incident so bookmarks and shared links land in
  // browser history with something readable, not the generic site title.
  useEffect(() => {
    const base = 'Chicago Transit Alerts';
    if (!incident) {
      document.title = base;
      return;
    }
    const isMerged = incident._type === 'merged';
    const isAlert = !isMerged && !!incident.alert_id;
    // Prefix the tab title with the route label so a generic CTA headline
    // (e.g. "Temporary Reroute") doesn't lose the route context the rest of
    // the page makes obvious.
    const label = formatRoutesLabel(incident.kind, incidentRoutes(incident));
    const desc = describeText(incident, isMerged, isAlert);
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
            <BrowseMenu alerts={data?.alerts} observations={data?.observations} />
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
              alerts={data.alerts}
              observations={data.observations}
              stationIndex={stationIndex}
            />
            <RelatedIncidents
              incident={incident}
              alerts={data.alerts}
              observations={data.observations}
              stationIndex={stationIndex}
            />
            <CrossLineContext
              incident={incident}
              alerts={data.alerts}
              observations={data.observations}
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
    return alias
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // CTA writes "Adams/ Wabash" with a stray space; the canonical name is
      // "Adams/Wabash". Allow whitespace around any `/` in the alias.
      .replace(/\//g, '\\s*/\\s*')
      // Hyphens and runs of whitespace are interchangeable: canonical
      // "UIC-Halsted" matches CTA's "UIC Halsted".
      .replace(/[\s-]+/g, '[\\s-]+');
  }
  const combined = new RegExp(
    `(?<![A-Za-z0-9])(?:${aliases.map((a) => aliasPattern(a.alias)).join('|')})(?![A-Za-z0-9])`,
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
  const seen = new Set();
  const out = [];
  function add(name) {
    if (!name) return;
    const key = name.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  }
  add(incident.affected_from_station);
  add(incident.affected_to_station);
  add(incident.from_station);
  add(incident.to_station);
  // mentioned_stations carries impact-context matches the upstream extractor
  // pulled from the alert text ("delays at Monroe"). Include after the
  // segment endpoints so the canonical "from → to" still renders first when
  // both are present; the dedupe keeps overlap from doubling up.
  for (const name of incident.mentioned_stations || []) add(name);
  return out;
}

// Quiet inline row of affected station links. No chunky pills — the line
// pill above already carries the brand color, so loud per-station chips
// just compete with it. These are supplementary navigation: dotted-
// underline links that match the rest of the site's station-name style.
// Caller decides whether to render at all (only useful when the headline
// doesn't already spell the stations out — see EventDetail).
function StationChips({ stations }) {
  if (!stations || stations.length === 0) return null;
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
              <span className="text-slate-400 dark:text-slate-500">→</span>
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

// The affected_* stations now render as chips at the top of the card;
// formatAffected is only left to surface the direction string (e.g.
// "Northbound only") for alerts that carry one without station scoping.
// Upstream stores the direction as a lowercase keyword (north/south/east/
// west/in/out) — title-case it so the rendered chip reads "South" not
// "south".
function formatAffected(incident) {
  const d = incident.affected_direction;
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

function EventDetail({ incident, alerts, observations, stationIndex }) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;
  const startTs = incident.first_seen_ts || incident.ts;
  const endTs = incident.resolved_ts ?? null;
  const duration = endTs ? formatDuration(endTs - startTs) : null;
  const cohortStats = useMemo(
    () => computeCohortDurationStats(incident, alerts, observations, { windowDays: 90 }),
    [incident, alerts, observations],
  );

  // CTA-planned-start callout. When CTA tagged the alert with an EventStart
  // that meaningfully predates our first sighting, the disruption was a
  // planned event scheduled in advance rather than a live reactive post.
  // Skipped when the gap is < 10 minutes (CTA fired effectively in real
  // time) or > 14 days (a stale EventStart from a long-running planned
  // alert isn't informative).
  let ctaPlannedPhrase = null;
  const ctaStart = incident.cta_event_start_ts ?? null;
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
  const ctaEndIsDateOnly = incident.cta_event_end_is_date_only === true;
  const activeEndPhrase =
    incident.active && incident.cta_event_end_ts != null
      ? formatEstimatedEnd(incident.cta_event_end_ts, undefined, { dateOnly: ctaEndIsDateOnly })
      : null;

  let ctaEstimateBlock = null;
  const ctaEnd = incident.cta_event_end_ts ?? null;
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
  let stabilizationDelta = null;
  if (
    isMerged &&
    incident.resolved_ts != null &&
    incident.obs_resolved_ts != null &&
    incident.obs_resolved_ts > incident.resolved_ts
  ) {
    stabilizationDelta = formatStabilizationDelta(incident.obs_resolved_ts - incident.resolved_ts);
  }
  const description = describe(incident, isMerged, isAlert, stationIndex);
  const affected = formatAffected(incident);
  const affectedStations = collectAffectedStations(incident);
  const resolvedUrl = incident.resolved_reply_url ?? incident.resolved_post_url ?? null;
  const obsResolvedUrl = isMerged ? (incident.obs_resolved_post_url ?? null) : null;
  const eventId = getEventId(incident);

  return (
    <article className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
        {incident.active && <span className="text-xs font-semibold text-red-500">ongoing</span>}
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
      {(isMerged || isAlert) && incident.kind !== 'bus' && (
        <StationChips stations={affectedStations} />
      )}

      {!isMerged && !isAlert && incident.signals?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Signals
          </span>
          {incident.signals.map((signal) => (
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
        const chip = formatEvidenceChip(incident);
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
      {incident.short_description && (
        <blockquote className="mt-4 border-l-2 border-slate-300 dark:border-gh-border pl-4 py-1">
          <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
            Per CTA
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
            {linkifyMentionedStations(
              incident.short_description,
              [
                ...(incident.mentioned_stations || []),
                // Broaden beyond the upstream extractor's list so any roster
                // station physically on this incident's line gets linked when
                // CTA's prose names it (e.g. "Garfield", "Ashland/63" on a
                // Green Line event that the extractor missed). Line-scoped to
                // avoid cross-line same-name bleed ("Halsted").
                ...stationsServingLines(incidentRoutes(incident)),
              ],
              stationIndex,
            )}
          </p>
        </blockquote>
      )}

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
                  <strong>{formatDate(ctaEnd)}</strong>{' '}
                  <span className="text-slate-400 dark:text-slate-500 text-xs">
                    ({activeEndPhrase})
                  </span>
                </>
              ) : (
                <>
                  <strong>{formatTime(ctaEnd)}</strong> on {formatDate(ctaEnd)}{' '}
                  <span className="text-slate-400 dark:text-slate-500 text-xs">
                    ({activeEndPhrase})
                  </span>
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
          tag a station fall through to just the mini timeline below. */}
      {incident.kind === 'train' && (
        <EventMap
          lineKey={incident.line ?? (Array.isArray(incident.routes) ? incident.routes[0] : null)}
          fromStation={incident.from_station ?? incident.affected_from_station ?? null}
          toStation={incident.to_station ?? incident.affected_to_station ?? null}
          active={!!incident.active}
        />
      )}

      <DurationScale stats={cohortStats} />

      <MiniTimeline incident={incident} alerts={alerts} observations={observations} />

      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-slate-100 dark:border-gh-border">
        <ShareLink eventId={eventId} title={description} />
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
            {(incident.extra_obs?.length ?? 0) > 0 && incident.obs_detection_source
              ? `Bot detection (${incident.obs_detection_source}) →`
              : 'Bot detection →'}
          </a>
        )}
        {isMerged &&
          (incident.extra_obs ?? []).map(
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
