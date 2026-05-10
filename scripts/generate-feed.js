// Generate dist/feed.xml — an Atom feed of the 50 most recent incidents
// (alerts + bot observations, merged the same way the UI merges them).
//
// Runs as a postbuild step, after `dist/data/alerts.json` is in place. The
// feed regenerates on every Pages deploy, which itself only happens when
// alerts.json changes — so the feed updates exactly when there's new data.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDuration } from '../src/lib/format.js';
import {
  formatEvidenceChip,
  formatRoutesLabel,
  mergeMatchingIncidents,
  normalizeAlertsPayload,
  observationSignals,
  postUrlRkey,
  SIGNAL_LABELS,
} from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(ROOT, 'dist', 'data', 'alerts.json');
const OUT = resolve(ROOT, 'dist', 'feed.xml');

const SITE = 'https://chicagotransitalerts.app';
// The 2026 here is the tag URI authority date (RFC 4151) — pinned forever,
// not a "current year". Changing it would alter every entry <id> and re-mark
// every subscriber's read entries as unread.
const FEED_ID = 'tag:chicagotransitalerts.app,2026:feed';
const ENTRY_LIMIT = 50;

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
function updatedTs(incident) {
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

function entryId(incident) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  if (rkey) return `tag:chicagotransitalerts.app,2026:event/${rkey}`;
  // Fallback for records without a Bluesky post (shouldn't happen in practice).
  return `tag:chicagotransitalerts.app,2026:${incident.alert_id ?? `obs-${incident.id}`}`;
}

function entryLink(incident) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  return rkey ? `${SITE}/event/${rkey}` : SITE;
}

function entryThumbnail(incident) {
  const rkey = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
  return rkey ? `${SITE}/event/${rkey}/og.png` : null;
}

function describeObservation(obs) {
  const stations = [obs.from_station, obs.to_station].filter(Boolean).join(' → ');
  const signals = observationSignals(obs);
  const signalsText = signals.length ? signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ') : null;
  if (stations && signalsText) return `${stations} — ${signalsText}`;
  if (stations) return stations;
  if (obs.detection_source === 'roundup' && signalsText) return `Multiple signals: ${signalsText}`;
  if (obs.detection_source === 'roundup') return 'Multiple simultaneous disruptions detected';
  if (signalsText) return `Service disruption detected: ${signalsText}`;
  return 'Service disruption detected';
}

function entryTitle(incident) {
  const kind = incident.kind;
  const routes = routesFor(incident);
  const routesLabel = formatRoutesLabel(kind, routes);
  if (incident.headline) return `${routesLabel}: ${incident.headline}`;
  return `${routesLabel}: ${describeObservation(incident)}`;
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
  const stateLine = resolved
    ? `<strong>Resolved</strong> after ${escapeXml(formatDuration(resolved - start) ?? '')}`
    : incident.active
      ? '<strong>Ongoing</strong>'
      : '';
  const stations = [incident.from_station, incident.to_station].filter(Boolean).join(' → ');
  const chip = formatEvidenceChip(incident);
  const headline = incident.headline ? escapeXml(incident.headline) : null;
  const fallback = headline ? null : escapeXml(describeObservation(incident));

  const parts = [];
  if (thumb) {
    const altText = headline || fallback || 'Service disruption';
    parts.push(`<p><img src="${escapeXml(thumb)}" alt="${altText}" width="1200" height="630"/></p>`);
  }
  if (stateLine) parts.push(`<p>${stateLine}</p>`);
  if (headline) parts.push(`<p>${headline}</p>`);
  if (fallback) parts.push(`<p>${fallback}</p>`);
  if (stations) parts.push(`<p><em>${escapeXml(stations)}</em></p>`);
  if (chip) parts.push(`<p>${escapeXml(chip)}</p>`);
  return parts.join('');
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function main() {
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  const payload = normalizeAlertsPayload(raw);
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    payload.alerts || [],
    payload.observations || [],
  );

  const all = [...merged, ...standaloneAlerts, ...standaloneObs]
    .filter((i) => startTs(i))
    .sort((a, b) => updatedTs(b) - updatedTs(a))
    .slice(0, ENTRY_LIMIT);

  const feedUpdated = all.length
    ? toIso(updatedTs(all[0]))
    : toIso(payload.generated_at || Date.now());

  const entries = all
    .map((incident) => {
      const id = entryId(incident);
      const link = entryLink(incident);
      const title = entryTitle(incident);
      const summary = entrySummary(incident);
      const published = toIso(startTs(incident));
      const updated = toIso(updatedTs(incident));
      const thumb = entryThumbnail(incident);
      const contentHtml = entryContentHtml(incident, thumb);
      const lines = [
        '  <entry>',
        `    <id>${escapeXml(id)}</id>`,
        `    <title>${escapeXml(title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
        `    <published>${published}</published>`,
        `    <updated>${updated}</updated>`,
        `    <summary>${escapeXml(summary)}</summary>`,
        // <content type="html"> needs the inner markup escaped so the parser
        // sees it as XML text — readers (Inoreader, Feedly, etc.) un-escape
        // and render the resulting HTML in their preview pane.
        `    <content type="html">${escapeXml(contentHtml)}</content>`,
      ];
      if (thumb) {
        lines.push(
          `    <media:thumbnail url="${escapeXml(thumb)}" width="1200" height="630"/>`,
          `    <media:content url="${escapeXml(thumb)}" medium="image" type="image/png" width="1200" height="630"/>`,
        );
      }
      lines.push('  </entry>');
      return lines.join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <id>${FEED_ID}</id>
  <title>CTA Alert History</title>
  <subtitle>Chicago Transit Authority service alerts and bot-detected disruptions.</subtitle>
  <link rel="alternate" type="text/html" href="${SITE}/"/>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="hub" href="https://pubsubhubbub.superfeedr.com/"/>
  <updated>${feedUpdated}</updated>
  <author><name>cta-alert-history</name></author>
${entries}
</feed>
`;

  writeFileSync(OUT, xml);
  console.log(`generate-feed: wrote ${all.length} entries to ${OUT}`);
}

main();
