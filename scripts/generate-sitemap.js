// Generate dist/sitemap.xml from the same payload the prerender steps use.
// Mirrors prerender-pages.js's scope so the sitemap only lists URLs that
// actually have prerendered HTML stubs and OG cards (i.e. pages that won't
// 404 for crawlers and look intentional when shared).
//
// Runs as a postbuild step after `dist/data/alerts.json` is in place.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAIN_LINE_ORDER } from '../src/lib/ctaLines.js';
import { chicagoDayUTC } from '../src/lib/format.js';
import { flattenIncidents, mergeMatchingIncidents, postUrlRkey } from '../src/lib/incidents.js';
import { buildStationIndex } from '../src/lib/stations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const OUT = resolve(DIST, 'sitemap.xml');

const SITE = 'https://chicagotransitalerts.app';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;

function escXml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isoDate(ms) {
  return new Date(ms).toISOString();
}

function urlEntry(loc, lastmod, changefreq, priority) {
  const parts = [`    <loc>${escXml(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${escXml(lastmod)}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${escXml(changefreq)}</changefreq>`);
  if (priority != null) parts.push(`    <priority>${priority.toFixed(1)}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

function main() {
  if (!existsSync(DATA)) {
    console.warn(`generate-sitemap: ${DATA} missing — skipping`);
    return;
  }
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  const payload = { ...raw, ...flattenIncidents(raw.incidents || []) };
  const generatedAt = payload.generated_at ?? Date.now();
  const generatedIso = isoDate(generatedAt);
  const cutoff = generatedAt - WINDOW_DAYS * DAY_MS;

  const entries = [];

  // Homepage — highest priority, ticks with every data refresh.
  entries.push(urlEntry(`${SITE}/`, generatedIso, 'hourly', 1.0));

  // Singletons.
  entries.push(urlEntry(`${SITE}/calendar`, generatedIso, 'daily', 0.7));
  entries.push(urlEntry(`${SITE}/stats`, generatedIso, 'daily', 0.7));
  entries.push(urlEntry(`${SITE}/compare`, generatedIso, 'monthly', 0.5));
  entries.push(urlEntry(`${SITE}/system/trains`, generatedIso, 'daily', 0.7));
  entries.push(urlEntry(`${SITE}/system/buses`, generatedIso, 'daily', 0.7));

  // Train lines — stable set of 8.
  for (const line of TRAIN_LINE_ORDER) {
    entries.push(urlEntry(`${SITE}/line/${line}`, generatedIso, 'daily', 0.7));
  }

  // Bus routes with at least one incident in the rolling window. Same scope
  // prerender-pages.js uses, so the sitemap and the OG-card set agree.
  const busRoutes = new Set();
  for (const o of payload.observations || []) {
    if (o.kind === 'bus' && o.line && o.ts >= cutoff) busRoutes.add(o.line);
  }
  for (const a of payload.alerts || []) {
    if (a.kind !== 'bus' || a.first_seen_ts < cutoff) continue;
    for (const r of a.routes || []) busRoutes.add(r);
  }
  for (const route of [...busRoutes].sort()) {
    entries.push(urlEntry(`${SITE}/route/${route}`, generatedIso, 'weekly', 0.5));
  }

  // Stations — already gated by buildStationIndex to those with ≥1 incident.
  const stations = buildStationIndex(payload.alerts ?? [], payload.observations ?? [], {
    now: generatedAt,
    windowDays: WINDOW_DAYS,
  });
  for (const slug of [...stations.keys()].sort()) {
    entries.push(urlEntry(`${SITE}/station/${slug}`, generatedIso, 'weekly', 0.5));
  }

  // Day pages — every Chicago calendar day in the last 30 days that had at
  // least one incident. Same gating as prerender-pages.js so the sitemap and
  // OG cards agree.
  const DAY_WINDOW_DAYS = 30;
  const todayUtc = chicagoDayUTC(generatedAt);
  const dayCutoff = todayUtc - (DAY_WINDOW_DAYS - 1) * DAY_MS;
  const daysWithIncidents = new Set();
  function offerDay(ts) {
    if (ts == null) return;
    const d = chicagoDayUTC(ts);
    if (d >= dayCutoff && d <= todayUtc) daysWithIncidents.add(d);
  }
  const {
    merged: dayMerged,
    standaloneAlerts: dayStandaloneAlerts,
    standaloneObs: dayStandaloneObs,
  } = mergeMatchingIncidents(payload.alerts ?? [], payload.observations ?? []);
  for (const m of dayMerged) offerDay(m.first_seen_ts);
  for (const a of dayStandaloneAlerts) offerDay(a.first_seen_ts);
  for (const o of dayStandaloneObs) offerDay(o.first_seen_ts ?? o.ts);
  for (const dayUtc of [...daysWithIncidents].sort((a, b) => b - a)) {
    const d = new Date(dayUtc);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    entries.push(urlEntry(`${SITE}/day/${iso}`, generatedIso, 'weekly', 0.5));
  }

  // Per-event pages. lastmod uses resolved_ts when available, else the
  // start time — same semantic as the Atom feed. Crawlers use lastmod to
  // decide whether to revisit, and resolved events don't keep changing.
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    payload.alerts ?? [],
    payload.observations ?? [],
  );
  const eventEntries = [];
  function pushEvent(rkey, lastTs) {
    if (!rkey) return;
    eventEntries.push(
      urlEntry(`${SITE}/event/${rkey}`, isoDate(lastTs ?? generatedAt), 'monthly', 0.4),
    );
  }
  for (const m of merged) {
    pushEvent(
      postUrlRkey(m.post_url) ?? postUrlRkey(m.obs_post_url),
      m.resolved_ts ?? m.first_seen_ts,
    );
  }
  for (const a of standaloneAlerts) {
    pushEvent(postUrlRkey(a.post_url), a.resolved_ts ?? a.first_seen_ts);
  }
  for (const o of standaloneObs) {
    pushEvent(postUrlRkey(o.post_url), o.resolved_ts ?? o.ts);
  }
  entries.push(...eventEntries);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

  writeFileSync(OUT, xml);
  console.log(`generate-sitemap: wrote ${entries.length} URLs to ${OUT}`);
}

main();
