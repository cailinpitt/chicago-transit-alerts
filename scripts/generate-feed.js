// Generate dist/feed.xml — an Atom feed of the 50 most recent incidents
// (alerts + bot observations, merged the same way the UI merges them).
//
// Runs as a postbuild step, after `dist/data/alerts.json` is in place. The
// feed regenerates on every Pages deploy, which itself only happens when
// alerts.json changes — so the feed updates exactly when there's new data.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUS_ROUTE_NAMES, compareBusRoutes } from '../src/lib/busRoutes.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../src/lib/ctaLines.js';
import { formatDuration, formatEstimatedEnd } from '../src/lib/format.js';
import {
  flattenIncidents,
  formatEvidenceChip,
  formatRoutesLabel,
  mergeMatchingIncidents,
  observationSignals,
  postUrlRkey,
  SIGNAL_LABELS,
  summarizeSignals,
} from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(ROOT, 'dist', 'data', 'alerts.json');
const OUT_ATOM = resolve(ROOT, 'dist', 'feed.xml');
const OUT_JSON = resolve(ROOT, 'dist', 'feed.json');

const SITE = 'https://chicagotransitalerts.app';
// The 2026 here is the tag URI authority date (RFC 4151) — pinned forever,
// not a "current year". Changing it would alter every entry/feed <id> and
// re-mark every subscriber's read entries as unread.
const TAG_AUTHORITY = 'tag:chicagotransitalerts.app,2026';
const ENTRY_LIMIT = 50;
// Skip standalone observation-only incidents that resolved within this window
// — almost always a transient detector hiccup (single missed snapshot, etc.)
// rather than a real outage worth pushing to subscribers. Anything backed by
// a CTA alert is surfaced regardless of duration; a CTA alert that came and
// went in 2 minutes is itself signal.
const FP_FILTER_MS = 5 * 60 * 1000;

function escapeXml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// An incident's update timestamp — what Atom <updated> should reflect. Drives
// re-surfacing in readers when an ongoing incident meaningfully changes state.
// We deliberately ignore `last_seen_ts`: for an active alert the upstream
// pipeline stamps it to the snapshot time, which would mark every active
// incident unread on every deploy. Resolution is the only state change worth
// re-surfacing for; otherwise the entry's start time is its updated time.
export function updatedTs(incident) {
  return incident.resolved_ts || incident._sortTs || incident.first_seen_ts || incident.ts;
}

function startTs(incident) {
  return incident._sortTs || incident.first_seen_ts || incident.ts;
}

function routesFor(incident) {
  if (Array.isArray(incident.routes)) return incident.routes;
  if (incident.line) return [incident.line];
  return [];
}

export function entryId(incident) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  if (rkey) return `tag:chicagotransitalerts.app,2026:event/${rkey}`;
  // Fallback for records without a Bluesky post (shouldn't happen in practice).
  return `tag:chicagotransitalerts.app,2026:${incident.alert_id ?? `obs-${incident.id}`}`;
}

function entryLink(incident) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  return rkey ? `${SITE}/event/${rkey}` : SITE;
}

// Cache-bust the OG image per-state. Readers and CDNs cache by URL, so without
// `?v=...` an incident that transitioned ongoing→resolved keeps showing the
// stale "ongoing" thumbnail. Keying on updatedTs flips the URL exactly when
// the state changes (entry's <updated> bumps too), so each state caches once.
function entryThumbnail(incident, updatedTs) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  if (!rkey) return null;
  return updatedTs ? `${SITE}/event/${rkey}/og.png?v=${updatedTs}` : `${SITE}/event/${rkey}/og.png`;
}

function blueskyPostUrl(incident) {
  return incident.post_url ?? incident.obs_post_url ?? null;
}

function describeObservation(obs) {
  const stations = [obs.from_station, obs.to_station].filter(Boolean).join(' → ');
  // Rider-facing impact phrase ("fewer trains and long gaps") rather than a
  // detector-name list, matching the app's incident titles.
  const summary = summarizeSignals(observationSignals(obs), obs.kind);
  if (stations && summary) return `${stations} — ${summary[0].toLowerCase()}${summary.slice(1)}`;
  if (stations) return stations;
  if (summary) return summary;
  if (obs.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  return 'Service disruption detected';
}

// True when the headline already names this incident's first route — in which
// case prepending the routes label produces awkward duplication ("#82
// Kimball-Homan: #82 Kimball/Homan…", "Brown Line: Brown Line Service…").
function headlineNamesRoute(headline, kind, routes) {
  if (!headline || !routes || routes.length === 0) return false;
  const lower = headline.toLowerCase();
  if (kind === 'bus') {
    // CTA bus headlines almost always lead with `#NN`; match that token
    // form to avoid stray substring hits like "53" inside a date or address.
    return new RegExp(`#${routes[0]}\\b`).test(lower);
  }
  // train: any route's full name ("Brown Line", "Red", "Yellow Line") in the
  // headline means the line is already identified.
  return routes.some((r) => {
    const label = TRAIN_LINES[r]?.label?.toLowerCase();
    return label && lower.includes(label);
  });
}

function entryTitle(incident) {
  const kind = incident.kind;
  const routes = routesFor(incident);
  const routesLabel = formatRoutesLabel(kind, routes);
  if (incident.headline) {
    if (headlineNamesRoute(incident.headline, kind, routes)) return incident.headline;
    return `${routesLabel}: ${incident.headline}`;
  }
  return `${routesLabel}: ${describeObservation(incident)}`;
}

// Friendly direction labels. The bot encodes pulse direction as
// `branch-0-outbound` / `branch-1-inbound` for loop lines, plus a synthetic
// `branch-len92-…` form (line bbox digest) for full-line outages — that one
// is meaningless to a reader, so suppress it. Bus alerts arrive as compass
// words or `'all'`; we map compass to `Northbound`/etc.
const COMPASS_LABELS = {
  north: 'Northbound',
  south: 'Southbound',
  east: 'Eastbound',
  west: 'Westbound',
  in: 'Inbound',
  out: 'Outbound',
};
function directionLabel(dir) {
  if (!dir) return null;
  if (dir === 'all') return null;
  if (dir.startsWith('branch-len')) return null;
  if (dir.endsWith('-outbound')) return 'Outbound';
  if (dir.endsWith('-inbound')) return 'Inbound';
  return COMPASS_LABELS[dir] ?? null;
}

function entrySummary(incident) {
  if (incident.headline) {
    const stations = [incident.from_station, incident.to_station].filter(Boolean).join(' → ');
    return stations ? `${incident.headline} (${stations})` : incident.headline;
  }
  return describeObservation(incident);
}

// Build a small HTML body for the entry's <content type="html">. Aimed at
// feed-reader preview panes that render real markup — gives readers a
// scannable card with state, segment, headline, and bot-evidence chip,
// rather than the one-line <summary> they'd otherwise show.
//
// Lead with an <img> when a thumbnail URL exists. Inoreader (and most other
// readers — Feedly, The Old Reader, NetNewsWire) extract the first <img>
// from the content as the entry thumbnail. media:thumbnail / media:content
// declarations alone are inconsistently honored, but the first inline image
// works everywhere.
function entryContentHtml(incident, thumb) {
  const start = startTs(incident);
  const resolved = incident.resolved_ts ?? null;
  // For still-ongoing incidents, append CTA's posted EventEnd ("estimated
  // end") when present and meaningfully in the future. Skipped on resolved
  // entries: the actual resolution time is more useful than a stale
  // estimate at that point.
  const estimatedEndText = !resolved
    ? formatEstimatedEnd(incident.cta_event_end_ts, undefined, {
        dateOnly: incident.cta_event_end_is_date_only === true,
      })
    : null;
  const stateLine = resolved
    ? `<strong>Resolved</strong> after ${escapeXml(formatDuration(resolved - start) ?? '')}`
    : incident.active
      ? estimatedEndText
        ? `<strong>Ongoing</strong> · CTA estimated end ${escapeXml(estimatedEndText)}`
        : '<strong>Ongoing</strong>'
      : '';
  const stations = [incident.from_station, incident.to_station].filter(Boolean).join(' → ');
  const chip = formatEvidenceChip(incident);
  const headline = incident.headline ? escapeXml(incident.headline) : null;
  const fallback = headline ? null : escapeXml(describeObservation(incident));
  const routesLabel = formatRoutesLabel(incident.kind, routesFor(incident));
  const direction = directionLabel(incident.direction ?? incident.affected_direction);
  const blueskyUrl = blueskyPostUrl(incident);

  const parts = [];
  if (thumb) {
    const altText = headline || fallback || 'Service disruption';
    parts.push(`<p><img src="${escapeXml(thumb)}" alt="${altText}"/></p>`);
  }
  if (stateLine) parts.push(`<p>${stateLine}</p>`);
  if (headline) parts.push(`<p>${headline}</p>`);
  if (fallback) parts.push(`<p>${fallback}</p>`);
  if (stations) parts.push(`<p><em>${escapeXml(stations)}</em></p>`);
  // Routes/direction line — show even when the headline already names the
  // route, so subscribers reading just the preview always see the affected
  // service at a glance.
  const meta = [routesLabel, direction].filter(Boolean).join(' · ');
  if (meta) parts.push(`<p>${escapeXml(meta)}</p>`);
  if (chip) parts.push(`<p>${escapeXml(chip)}</p>`);
  if (blueskyUrl) {
    parts.push(`<p><a href="${escapeXml(blueskyUrl)}">View original post on Bluesky →</a></p>`);
  }
  return parts.join('');
}

// Atom <category>/JSON tags. Built as a list of {term, label} pairs:
//   - mode: bus | train
//   - per-route: route-82 (#82) for bus; line-brown (Brown Line) for train
//   - state: ongoing | resolved
//   - source: cta-alert and/or any signal kinds (pulse-cold, ghost, …)
// Atom uses term + optional label; JSON Feed gets the labels.
function entryCategories(incident) {
  const cats = [];
  const kind = incident.kind;
  if (kind === 'bus' || kind === 'train') {
    cats.push({ term: kind, label: kind === 'bus' ? 'Bus' : 'Train' });
  }
  const routes = routesFor(incident);
  if (kind === 'train') {
    for (const r of routes) {
      const label = TRAIN_LINES[r]?.label;
      cats.push({ term: `line-${r}`, label: label ? `${label} Line` : r });
    }
  } else if (kind === 'bus') {
    for (const r of routes) cats.push({ term: `route-${r}`, label: `#${r}` });
  }
  cats.push(
    incident.resolved_ts
      ? { term: 'resolved', label: 'Resolved' }
      : incident.active
        ? { term: 'ongoing', label: 'Ongoing' }
        : { term: 'closed', label: 'Closed' },
  );
  // Sources: an alert-backed incident gets `cta-alert`; observation signals
  // (pulse-cold, ghost, bunching, …) come from observationSignals which
  // already handles roundup unwrapping.
  if (incident.alert_id || incident.headline) {
    cats.push({ term: 'cta-alert', label: 'CTA Alert' });
  }
  // Merged records expose detection_source as obs_detection_source — pass a
  // shim so observationSignals' single-key probe finds it. Standalone obs
  // already match the key directly.
  const obsLike = incident.obs_detection_source
    ? { detection_source: incident.obs_detection_source, signals: incident.obs_signals }
    : incident;
  for (const sig of observationSignals(obsLike)) {
    cats.push({ term: sig, label: SIGNAL_LABELS[sig] ?? sig });
  }
  return cats;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

// Filter out standalone observations that resolved within FP_FILTER_MS — they
// almost always represent a transient detector hiccup (single missed
// snapshot, a pulse that flips back inside the same minute) rather than a
// real outage worth a push notification. Anything backed by a CTA alert
// (merged or standalone alert) passes regardless of duration.
export function isLikelyDetectorBlip(incident) {
  if (incident.alert_id || incident.headline) return false; // alert-backed
  if (!incident.resolved_ts) return false;
  const start = startTs(incident);
  if (!start) return false;
  return incident.resolved_ts - start < FP_FILTER_MS;
}

export function buildEntryRecord(incident) {
  const id = entryId(incident);
  const link = entryLink(incident);
  const title = entryTitle(incident);
  const summary = entrySummary(incident);
  const publishedMs = startTs(incident);
  const updatedMs = updatedTs(incident);
  const thumb = entryThumbnail(incident, updatedMs);
  const contentHtml = entryContentHtml(incident, thumb);
  const categories = entryCategories(incident);
  const blueskyUrl = blueskyPostUrl(incident);
  return {
    id,
    link,
    title,
    summary,
    publishedMs,
    updatedMs,
    thumb,
    contentHtml,
    categories,
    blueskyUrl,
  };
}

export function emitAtom(records, feedUpdatedIso, meta) {
  const entries = records
    .map((r) => {
      const lines = [
        '  <entry>',
        `    <id>${escapeXml(r.id)}</id>`,
        `    <title>${escapeXml(r.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(r.link)}"/>`,
        `    <published>${toIso(r.publishedMs)}</published>`,
        `    <updated>${toIso(r.updatedMs)}</updated>`,
        `    <summary>${escapeXml(r.summary)}</summary>`,
        // <content type="html"> needs the inner markup escaped so the parser
        // sees it as XML text — readers (Inoreader, Feedly, etc.) un-escape
        // and render the resulting HTML in their preview pane.
        `    <content type="html">${escapeXml(r.contentHtml)}</content>`,
      ];
      for (const c of r.categories) {
        lines.push(
          c.label
            ? `    <category term="${escapeXml(c.term)}" label="${escapeXml(c.label)}"/>`
            : `    <category term="${escapeXml(c.term)}"/>`,
        );
      }
      if (r.thumb) {
        lines.push(
          `    <media:thumbnail url="${escapeXml(r.thumb)}"/>`,
          `    <media:content url="${escapeXml(r.thumb)}" medium="image" type="image/png"/>`,
        );
      }
      lines.push('  </entry>');
      return lines.join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <id>${escapeXml(meta.id)}</id>
  <title>${escapeXml(meta.title)}</title>
  <subtitle>${escapeXml(meta.subtitle)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(meta.homeUrl)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(meta.selfXml)}"/>
  <link rel="alternate" type="application/feed+json" href="${escapeXml(meta.selfJson)}"/>
  <link rel="hub" href="https://pubsubhubbub.superfeedr.com/"/>
  <updated>${feedUpdatedIso}</updated>
  <author><name>chicago-transit-alerts</name></author>
${entries}
</feed>
`;
}

function emitJsonFeed(records, meta) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    description: meta.subtitle,
    home_page_url: meta.homeUrl,
    feed_url: meta.selfJson,
    language: 'en-US',
    authors: [{ name: 'chicago-transit-alerts' }],
    hubs: [{ type: 'WebSub', url: 'https://pubsubhubbub.superfeedr.com/' }],
    items: records.map((r) => ({
      id: r.id,
      url: r.link,
      external_url: r.blueskyUrl ?? undefined,
      title: r.title,
      summary: r.summary,
      content_html: r.contentHtml,
      image: r.thumb ?? undefined,
      banner_image: r.thumb ?? undefined,
      date_published: toIso(r.publishedMs),
      date_modified: toIso(r.updatedMs),
      tags: r.categories.map((c) => c.label || c.term),
    })),
  };
}

// Feed-level metadata for a given scope. `idPath`/`selfBase` are appended to
// the tag authority and site root respectively, so the global feed and every
// per-line/route feed carry a stable, distinct <id> and self link.
export function feedMeta({ idPath, title, subtitle, homePath, selfBase }) {
  return {
    id: `${TAG_AUTHORITY}:${idPath}`,
    title,
    subtitle,
    homeUrl: `${SITE}${homePath}`,
    selfXml: `${SITE}${selfBase}.xml`,
    selfJson: `${SITE}${selfBase}.json`,
  };
}

// Write one feed's Atom + JSON pair, creating the parent directory as needed
// (the per-line/route feeds live under dist/feed/{line,route}/).
function writeFeed(records, meta, feedUpdatedIso, xmlPath, jsonPath) {
  mkdirSync(dirname(xmlPath), { recursive: true });
  writeFileSync(xmlPath, emitAtom(records, feedUpdatedIso, meta));
  writeFileSync(jsonPath, `${JSON.stringify(emitJsonFeed(records, meta), null, 2)}\n`);
}

// Most-recent-first slice of `pool` scoped to one route, capped at ENTRY_LIMIT.
// `pool` is already sorted newest-first, so the slice preserves that order.
export function scopedRecords(pool, kind, route) {
  return pool
    .filter((i) => i.kind === kind && routesFor(i).includes(route))
    .slice(0, ENTRY_LIMIT)
    .map(buildEntryRecord);
}

function main() {
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  const payload = { ...raw, ...flattenIncidents(raw.incidents || []) };
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    payload.alerts || [],
    payload.observations || [],
  );

  let dropped = 0;
  // Full candidate set (newest first), not yet capped — each scoped feed takes
  // its own most-recent ENTRY_LIMIT from this pool.
  const pool = [...merged, ...standaloneAlerts, ...standaloneObs]
    .filter((i) => startTs(i))
    .filter((i) => {
      if (isLikelyDetectorBlip(i)) {
        dropped++;
        return false;
      }
      return true;
    })
    .sort((a, b) => updatedTs(b) - updatedTs(a));

  const feedUpdated = pool.length
    ? toIso(updatedTs(pool[0]))
    : toIso(payload.generated_at || Date.now());
  // Per-scope <updated>: the newest entry in that scope (records are
  // newest-first), falling back to the global timestamp for an empty scope.
  const isoUpdated = (records) => (records.length ? toIso(records[0].updatedMs) : feedUpdated);

  // Global feed — unchanged URLs and <id>, so existing subscribers are
  // unaffected by the per-line additions below.
  const globalRecords = pool.slice(0, ENTRY_LIMIT).map(buildEntryRecord);
  writeFeed(
    globalRecords,
    feedMeta({
      idPath: 'feed',
      title: 'Chicago Transit Alerts',
      subtitle: 'Chicago Transit Authority service alerts and bot-detected disruptions.',
      homePath: '/',
      selfBase: '/feed',
    }),
    feedUpdated,
    OUT_ATOM,
    OUT_JSON,
  );

  // One feed per train line (all eight) and one per bus route in the CTA
  // roster — every line/route is subscribable up front, so a rider can follow
  // their route today and just get a quiet feed until something happens,
  // rather than waiting for a first incident to bring the feed into existence.
  let lineFeeds = 0;
  for (const line of TRAIN_LINE_ORDER) {
    const records = scopedRecords(pool, 'train', line);
    const label = TRAIN_LINES[line]?.label ?? line;
    writeFeed(
      records,
      feedMeta({
        idPath: `feed/line/${line}`,
        title: `Chicago Transit Alerts · ${label} Line`,
        subtitle: `CTA service alerts and bot-detected disruptions on the ${label} Line.`,
        homePath: `/line/${line}`,
        selfBase: `/feed/line/${line}`,
      }),
      isoUpdated(records),
      resolve(ROOT, 'dist', 'feed', 'line', `${line}.xml`),
      resolve(ROOT, 'dist', 'feed', 'line', `${line}.json`),
    );
    lineFeeds++;
  }

  let routeFeeds = 0;
  for (const route of Object.keys(BUS_ROUTE_NAMES).sort(compareBusRoutes)) {
    const records = scopedRecords(pool, 'bus', route);
    const name = BUS_ROUTE_NAMES[route];
    const label = name ? `#${route} ${name}` : `#${route}`;
    writeFeed(
      records,
      feedMeta({
        idPath: `feed/route/${route}`,
        title: `Chicago Transit Alerts · ${label}`,
        subtitle: `CTA service alerts and bot-detected disruptions on the ${label} bus.`,
        homePath: `/route/${route}`,
        selfBase: `/feed/route/${route}`,
      }),
      isoUpdated(records),
      resolve(ROOT, 'dist', 'feed', 'route', `${route}.xml`),
      resolve(ROOT, 'dist', 'feed', 'route', `${route}.json`),
    );
    routeFeeds++;
  }

  const droppedNote = dropped > 0 ? ` (${dropped} short-lived obs skipped)` : '';
  console.log(
    `generate-feed: wrote ${globalRecords.length} entries to feed.xml + feed.json, ` +
      `plus ${lineFeeds} line + ${routeFeeds} route feeds${droppedNote}`,
  );
}

// Run only when invoked directly (`node scripts/generate-feed.js`), not when
// imported by tests — the pure builders below are exported for unit testing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
