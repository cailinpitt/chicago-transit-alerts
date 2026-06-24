// Prerender per-event HTML stubs and OG images so social media crawlers
// (Twitter, Bluesky, Slack, etc.) get event-specific cards. Crawlers don't run
// JS; they just read meta tags from whatever HTML the URL serves. This script
// emits `dist/event/<id>/index.html` (clone of the SPA shell with rewritten
// OG meta) plus `dist/event/<id>/og.png` (1200x630, Playwright-rendered).
//
// Runs as a postbuild step. Requires `dist/data/alerts.json` to be present —
// it's copied from `public/data/` by Vite at build time.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { breadcrumbJsonLd, eventTrail } from '../src/lib/breadcrumbs.js';
import { normalizeTrainLine, TRAIN_LINES } from '../src/lib/ctaLines.js';
import { formatDate, formatTime } from '../src/lib/format.js';
import {
  formatRoutesLabel,
  groupIncidentRecords,
  incidentRecords,
  observationSignals,
  summarizeSignals,
} from '../src/lib/incidents.js';
import { gateIncidents } from '../src/lib/metraGate.js';
import { METRA_LINES, normalizeMetraLine } from '../src/lib/metraLines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const SHELL = resolve(DIST, 'index.html');
// standard.site manifest (event id -> document AT-URI). The publication <link>
// tag is already in the shell (prerender-standard-site runs first); here we add
// the per-event document tag on canonical pages so the record's `path`
// (/event/:id) matches the page URL and the enhanced card verifies.
const STANDARD_SITE_DOCS = (() => {
  try {
    return JSON.parse(readFileSync(resolve(DIST, 'data', 'standard-site.json'), 'utf8')).documents;
  } catch (_) {
    return {};
  }
})();
const TEMPLATE = resolve(__dirname, 'og-event-template.html');
// Image cache survives across builds via actions/cache. Only the PNG and its
// signature live here — the HTML stub is regenerated every build because it
// embeds the freshly hashed asset paths from `dist/index.html`.
const CACHE = resolve(ROOT, '.og-cache');
const CONCURRENCY = Number(process.env.PRERENDER_CONCURRENCY ?? 6);

const SITE = 'https://chicagotransitalerts.app';
const BUS_ACCENT = { color: '#475569', soft: 'rgba(71, 85, 105, 0.18)', text: '#fff' };

function postUrlRkey(url) {
  if (!url) return null;
  const m = /\/post\/([^/?#]+)/.exec(url);
  return m ? m[1] : null;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// standard.site document <link> tag for an event page. Canonical /event/:id only
// (its record path matches the page); the /resolved variant carries the document
// via the post's associatedRefs instead, so it gets no tag. Empty string when no
// record exists for the id. Exported for tests.
export function documentLinkTag(id, variant, docs = STANDARD_SITE_DOCS) {
  const uri = variant === 'canonical' ? docs?.[id] : null;
  return uri ? `\n    <link rel="site.standard.document" href="${escAttr(uri)}" />` : '';
}

function softColor(hex, alpha = 0.18) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function accentFor(incident) {
  // Multi-route alerts use a kind-based label (e.g. `#136, #147, #151` or
  // `Red and Purple Lines`) so the OG card reflects the full footprint, not
  // just the first listed route.
  const routes =
    Array.isArray(incident.routes) && incident.routes.length > 0
      ? incident.routes
      : incident.line
        ? [incident.line]
        : [];
  const label = formatRoutesLabel(incident.kind, routes) || 'CTA';

  // `chips` renders one pill per affected line/route on the card, mirroring the
  // SPA's LinePill — a Pink+Green incident shows a pink chip *and* a green chip
  // rather than one chip miscolored as the first line. `label` is still the
  // combined text used for meta tags / JSON-LD; the chips are the visual.
  if (incident.kind === 'train') {
    const chips = routes.map((r) => {
      const line = TRAIN_LINES[normalizeTrainLine(r)];
      return line
        ? { color: line.color, text: line.textColor, label: `${line.label} Line` }
        : { color: BUS_ACCENT.color, text: BUS_ACCENT.text, label: r };
    });
    // The left bar + background tint stay a single accent (the first line) —
    // a gradient across N brand colors reads as noise at card size.
    const first = TRAIN_LINES[normalizeTrainLine(routes[0] ?? '')];
    if (first) {
      return {
        color: first.color,
        soft: softColor(first.color, 0.22),
        text: first.textColor,
        label,
        chips: chips.length > 0 ? chips : [{ ...stripSoft(BUS_ACCENT), label }],
      };
    }
    return {
      ...BUS_ACCENT,
      label,
      chips: chips.length > 0 ? chips : [{ ...stripSoft(BUS_ACCENT), label }],
    };
  }
  // Metra — same chip-per-line treatment as train, but keyed off METRA_LINES
  // (lowercase web keys) and without the " Line" suffix (Metra lines are named
  // outright, e.g. "Rock Island"). Metra incidents are single-line in practice,
  // but the map handles a multi-route payload the same way.
  if (incident.kind === 'metra') {
    const chips = routes.map((r) => {
      const line = METRA_LINES[normalizeMetraLine(r)];
      return line
        ? { color: line.color, text: line.textColor, label: line.label }
        : { color: BUS_ACCENT.color, text: BUS_ACCENT.text, label: r };
    });
    const first = METRA_LINES[normalizeMetraLine(routes[0] ?? '')];
    if (first) {
      return {
        color: first.color,
        soft: softColor(first.color, 0.22),
        text: first.textColor,
        label,
        chips: chips.length > 0 ? chips : [{ ...stripSoft(BUS_ACCENT), label }],
      };
    }
    return {
      ...BUS_ACCENT,
      label,
      chips: chips.length > 0 ? chips : [{ ...stripSoft(BUS_ACCENT), label }],
    };
  }
  // Bus alerts keep a single neutral chip — multi-route bus labels already
  // collapse to bare numbers (`#136, #147, #151`), which there's no brand
  // color to split by.
  return { ...BUS_ACCENT, label, chips: [{ ...stripSoft(BUS_ACCENT), label }] };
}

// Drop the `soft` key from an accent so it can be reused as a chip descriptor
// ({ color, text, label }) without leaking the background-tint field.
function stripSoft({ color, text }) {
  return { color, text };
}

function describeObservation(obs) {
  // Rider-facing impact phrase ("fewer trains and long gaps"), matching the
  // app's incident titles, rather than a detector-name list.
  const summary = summarizeSignals(observationSignals(obs), obs.kind);
  if (!summary) return 'Service disruption detected by bot.';
  const impact = `${summary[0].toLowerCase()}${summary.slice(1)}`;
  // Buses run on a "route", trains and Metra on a "line". Skip the suffix
  // entirely when the phrase already names the route (thin-gap → "route not
  // running"), so it doesn't read "route not running on this route".
  const where = obs.kind === 'bus' ? ' on this route' : ' on this line';
  const tail = /\broute\b/.test(impact) ? '' : where;
  return `Bot detected ${impact}${tail}.`;
}

// When the incident first occurred, for the OG card — matches the event
// page's "First seen" line ("May 14, 2024 · 4:43 PM", Chicago time) so a
// shared card reads the same as the page it links to, and a months-old
// incident no longer looks like it's happening right now. Uses the same
// start instant as the JSON-LD `startDate`.
function formatCardDate(incident) {
  const ts = incident.first_seen_ts ?? incident.ts ?? null;
  if (ts == null) return null;
  return `${formatDate(ts)} · ${formatTime(ts)}`;
}

// Headline for a bot-detected incident. On the card it pairs with the line as
// `${BOT_IMPACT} · ${label}` (the line is also a chip); in the link/meta title
// it leads with the line as `${label} · ${BOT_IMPACT}` so the line isn't
// repeated. Kept as one const so the two orderings can't drift apart.
const BOT_IMPACT = 'Disruption detected';

function summarize(incident) {
  if (incident.headline) {
    const agency = incident.kind === 'metra' ? 'Metra' : 'CTA';
    return {
      title: incident.headline,
      subtitle: `${agency} service alert · archived on chicagotransitalerts.app`,
    };
  }
  const accent = accentFor(incident);
  return {
    title: `${BOT_IMPACT} · ${accent.label}`,
    subtitle: describeObservation(incident),
  };
}

function pickIncidents(payload) {
  // Mirror what the SPA shows: merged + standalone. We dedupe by event id so a
  // merged incident doesn't also produce a stub for its underlying alert.
  const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords(
    payload.officialRecords ?? [],
    payload.detectionRecords ?? [],
  );
  const out = new Map();
  const add = (incident) => {
    const id = postUrlRkey(incident.post_url) ?? postUrlRkey(incident.obs_post_url);
    if (!id || out.has(id)) return;
    out.set(id, incident);
  };
  merged.forEach(add);
  standaloneAlerts.forEach(add);
  standaloneObs.forEach(add);

  // Every post URL exposed by findIncidentById is shareable. Emit the same
  // prerendered page/card under the grouped incident id and every official or
  // detection post rkey, not only under the canonical primary post. Resolution
  // replies link by their own thread root rkey, which may become a non-primary
  // alias after producer-side grouping changes.
  for (const inc of payload.incidents ?? []) {
    const officialAlerts =
      Array.isArray(inc.official_alerts) && inc.official_alerts.length > 0
        ? inc.official_alerts
        : inc.official_alert
          ? [inc.official_alert]
          : [];
    const aliases = [
      inc.id,
      ...officialAlerts.map((alert) => postUrlRkey(alert?.post_url)),
      ...(inc.detections ?? []).map((detection) => postUrlRkey(detection?.post_url)),
    ].filter(Boolean);
    if (aliases.length === 0) continue;
    const canonicalId =
      aliases.find((id) => out.has(id)) ??
      (out.has(inc.id) ? inc.id : null) ??
      postUrlRkey(inc.official_alert?.post_url);
    const canonicalIncident = canonicalId ? out.get(canonicalId) : null;
    if (!canonicalIncident) continue;
    for (const alias of aliases) {
      if (!out.has(alias)) out.set(alias, canonicalIncident);
    }
  }
  return out;
}

// Build a schema.org Event JSON-LD payload for crawler / search consumption.
// schema.org has no perfect "service disruption" type, but Event matches
// the start/end/name shape and is recognized by Google's rich-results
// pipeline. Returned as a string ready to embed in <script>.
function buildJsonLd(incident, { ogTitle, desc, url }) {
  const startTs = incident.first_seen_ts ?? incident.ts ?? null;
  const endTs = incident.resolved_ts ?? null;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': url,
    name: ogTitle,
    description: desc,
    url,
    eventStatus:
      endTs != null ? 'https://schema.org/EventCompleted' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true,
  };
  if (startTs != null) ld.startDate = new Date(startTs).toISOString();
  if (endTs != null) ld.endDate = new Date(endTs).toISOString();
  // Use the incident's segment endpoints as a place name when available.
  // Schema.org Event.location accepts a Place; we attach a name only since
  // we don't carry geo coordinates per station.
  const fromStation = incident.from_station ?? incident.affected_from_station ?? null;
  const toStation = incident.to_station ?? incident.affected_to_station ?? null;
  const locationName =
    fromStation && toStation ? `${fromStation} → ${toStation}` : (fromStation ?? toStation ?? null);
  if (locationName) {
    ld.location = {
      '@type': 'Place',
      name: locationName,
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL' },
    };
  } else {
    ld.location = {
      '@type': 'Place',
      name: incident.kind === 'metra' ? 'Metra' : 'Chicago Transit Authority',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL' },
    };
  }
  ld.organizer = {
    '@type': 'Organization',
    name: 'Chicago Transit Alerts (unofficial)',
    url: SITE,
  };
  return JSON.stringify(ld);
}

function buildHtmlStub(shell, { id, title, subtitle, accent, incident, variant = 'canonical' }) {
  // Canonical always points at the bare /event/:id URL — the /resolved variant
  // exists only as a Bluesky-card-cache target, not a separate page in its own
  // right, so search engines should fold it back to canonical and skip indexing.
  const canonicalUrl = `${SITE}/event/${id}`;
  const url = variant === 'resolved' ? `${canonicalUrl}/resolved` : canonicalUrl;
  // og.png is served alongside index.html in the same directory, so a relative
  // path is fine here. Use the variant's directory so /event/:id/resolved/og.png
  // (the variant's own image) ships with the variant stub.
  const image = `${url}/og.png`;
  // Link/unfurl title leads with the line/route. For bot events the card title
  // ends with the line (it's also a chip), so build the meta title from the bare
  // impact to avoid repeating it ("Red Line · Disruption detected"). CTA titles
  // keep the label prefix — a bare headline like "Temporary Reroute" otherwise
  // names no route.
  const ogTitle = (
    incident.headline ? `${accent.label} · ${title}` : `${accent.label} · ${BOT_IMPACT}`
  ).slice(0, 200);
  const desc = subtitle.slice(0, 280);
  // Inject JSON-LD just before </head>. `<` inside the JSON has to be escaped
  // because </script> in a string literal would otherwise close the tag.
  const jsonLd = buildJsonLd(incident, { ogTitle, desc, url }).replaceAll('<', '\\u003c');
  // BreadcrumbList trail (Home › day › this incident) — mirrors the visible
  // trail the page renders via lib/breadcrumbs, so structured data and UI agree.
  const trail = eventTrail(incident.first_seen_ts ?? incident.ts ?? null, accent.label);
  const breadcrumbLd = JSON.stringify(breadcrumbJsonLd(trail, SITE)).replaceAll('<', '\\u003c');
  const ldTag =
    `<script type="application/ld+json">${jsonLd}</script>` +
    `\n    <script type="application/ld+json">${breadcrumbLd}</script>`;
  const docTag = documentLinkTag(id, variant);
  // canonical always points at the bare URL even on the /resolved variant —
  // search engines should treat /resolved as a duplicate, not a separate page.
  let html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(ogTitle)} — Chicago Transit Alerts</title>`)
    .replace(
      /<link rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${escAttr(canonicalUrl)}" />`,
    )
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escAttr(url)}" />`,
    )
    .replace(
      /<meta property="og:image"[^>]*>/g,
      `<meta property="og:image" content="${escAttr(image)}" />`,
    )
    .replace(
      /<meta property="og:image:alt"[^>]*>/,
      `<meta property="og:image:alt" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta name="twitter:image"[^>]*>/g,
      `<meta name="twitter:image" content="${escAttr(image)}" />`,
    )
    .replace(
      /<meta name="twitter:image:alt"[^>]*>/,
      `<meta name="twitter:image:alt" content="${escAttr(ogTitle)}" />`,
    )
    .replace('</head>', `${ldTag}${docTag}\n  </head>`);
  if (variant === 'resolved') {
    // noindex the variant — it's a Bluesky-card-cache target, not a destination
    // page. Without this, search engines see /event/:id and /event/:id/resolved
    // as two near-identical pages competing for the same incident. Replace the
    // shell's default index,follow so the page carries a single robots directive.
    html = html.replace(
      /<meta name="robots"[^>]*>/,
      '<meta name="robots" content="noindex,follow" />',
    );
  }
  return html;
}

// Swap the static "…with the CTA" disclaimer to "…with Metra" on Metra event
// cards, mirroring applyDisclaimer in prerender-pages.js. Keeps the shared OG
// template otherwise untouched.
function applyDisclaimer(html, kind) {
  return kind === 'metra'
    ? html.replace('Not affiliated with the CTA', 'Not affiliated with Metra')
    : html;
}

function fillTemplate(tpl, fields) {
  // One pill per affected line/route. Colors are inlined per chip so each
  // carries its own brand color (the template's `--accent` only drives the
  // bar + tint). Falls back to the combined label if chips are somehow absent.
  const chips = fields.accent.chips ?? [
    { color: fields.accent.color, text: fields.accent.text, label: fields.accent.label },
  ];
  const chipsHtml = chips
    .map(
      (c) =>
        `<div class="badge line" style="background: ${c.color}; color: ${c.text};">${escHtml(c.label)}</div>`,
    )
    .join('\n        ');
  // Date — pinned top-right (see .date-corner). Omitted entirely when the
  // incident carries no usable timestamp, so nothing renders rather than an
  // empty element.
  const dateHtml = fields.date ? `<div class="date-corner">${escHtml(fields.date)}</div>` : '';
  const html = tpl
    .replaceAll('__ACCENT__', fields.accent.color)
    .replaceAll('__ACCENT_SOFT__', fields.accent.soft)
    .replaceAll('__ACCENT_TEXT__', fields.accent.text)
    .replaceAll('__LINE_CHIPS__', chipsHtml)
    .replaceAll('__DATE__', dateHtml)
    .replaceAll('__BADGE__', fields.badge)
    .replaceAll('__TITLE__', escHtml(fields.title))
    .replaceAll('__SUBTITLE__', escHtml(fields.subtitle))
    .replaceAll('__EVENT_ID__', escHtml(fields.id));
  return applyDisclaimer(html, fields.kind);
}

// Hash the inputs that affect the rendered PNG. If this is unchanged from the
// last build's signature, we can skip Playwright entirely for this event.
function signatureFor({ id, title, subtitle, badge, date, accent, templateHash, kind }) {
  const h = createHash('sha256');
  // The Metra disclaimer swap (fillTemplate) changes the rendered PNG without
  // touching any field below, so fold the agency in to bust the cache.
  const disc = kind === 'metra' ? 'metra' : undefined;
  h.update(JSON.stringify({ id, title, subtitle, badge, date, accent, templateHash, disc }));
  return h.digest('hex');
}

async function renderPng(page, html, outPath) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({
    path: outPath,
    type: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
}

async function workerPool(items, size, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!existsSync(DATA)) {
    console.warn(`prerender-events: ${DATA} missing — skipping (build copies public/data first)`);
    return;
  }
  // Flatten the nested `incidents[]` wire shape into the flat
  // `{ alerts, observations }` the merge/label helpers below expect. Train line
  // keys arrive already normalized to full names ('green') from the export, so
  // formatRoutesLabel can look them up in TRAIN_LINES directly.
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  // Metra is launched and the event OG card is Metra-aware (accentFor +
  // describeObservation handle kind='metra'), so opt in explicitly — Metra event
  // pages get their own prerendered stub + per-event OG image like CTA events.
  raw.incidents = gateIncidents(raw.incidents || [], true);
  const payload = { ...raw, ...incidentRecords(raw.incidents || []) };
  const shell = readFileSync(SHELL, 'utf8');
  const template = readFileSync(TEMPLATE, 'utf8');
  const templateHash = createHash('sha256').update(template).digest('hex').slice(0, 16);

  const incidents = pickIncidents(payload);
  if (incidents.size === 0) {
    console.log('prerender-events: no incidents to prerender');
    return;
  }

  mkdirSync(CACHE, { recursive: true });

  // Plan each event: always emit the HTML stub; queue PNG render only on a
  // signature miss.
  //
  // Two variants per event:
  //   /event/:id           — canonical URL; badge tracks `incident.active`.
  //   /event/:id/resolved  — same view, badge HARDCODED to 'Archived'. Used
  //     by cta-insights resolution replies so Bluesky's URL-keyed card
  //     cache shows the correct status. The 'Active' variant of an incident
  //     that later resolves still stays correct because the canonical URL
  //     is re-rendered on the next build.
  const renders = [];
  const seenIds = new Set();
  for (const [id, incident] of incidents) {
    seenIds.add(id);
    const accent = accentFor(incident);
    const { title, subtitle } = summarize(incident);
    const date = formatCardDate(incident);

    // Variant A: canonical /event/:id (badge reflects current state).
    const canonicalBadge = incident.active ? 'Active' : 'Archived';
    const canonicalSig = signatureFor({
      id,
      title,
      subtitle,
      badge: canonicalBadge,
      date,
      accent,
      templateHash,
      kind: incident.kind,
    });
    const canonicalDir = resolve(DIST, 'event', id);
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(
      resolve(canonicalDir, 'index.html'),
      buildHtmlStub(shell, { id, title, subtitle, accent, incident, variant: 'canonical' }),
    );
    const cacheDir = resolve(CACHE, id);
    const cachedPng = resolve(cacheDir, 'og.png');
    const cachedSig = resolve(cacheDir, 'sig');
    const canonicalCached =
      existsSync(cachedPng) &&
      existsSync(cachedSig) &&
      readFileSync(cachedSig, 'utf8') === canonicalSig;
    if (canonicalCached) {
      copyFileSync(cachedPng, resolve(canonicalDir, 'og.png'));
    } else {
      renders.push({
        id,
        html: fillTemplate(template, {
          id,
          title,
          subtitle,
          badge: canonicalBadge,
          date,
          accent,
          kind: incident.kind,
        }),
        outDir: canonicalDir,
        cacheDir,
        cachedPng,
        cachedSig,
        sig: canonicalSig,
      });
    }

    // Variant B: /event/:id/resolved (always 'Archived'). Skip when the
    // canonical variant is *also* Archived — the URL exists either way, but
    // the PNG is byte-identical to canonical, so just copy it instead of
    // burning a second render.
    const resolvedDir = resolve(DIST, 'event', id, 'resolved');
    mkdirSync(resolvedDir, { recursive: true });
    writeFileSync(
      resolve(resolvedDir, 'index.html'),
      buildHtmlStub(shell, { id, title, subtitle, accent, incident, variant: 'resolved' }),
    );
    if (canonicalBadge === 'Archived') {
      // PNG will be written to canonicalDir at render time; copy after.
      renders.push({
        id: `${id}#resolved-mirror`,
        // The mirror copy is queued as a post-render step. Mark with a sentinel
        // html=null so the worker pool can no-op the playwright render and
        // instead copy from the canonical output.
        html: null,
        outDir: resolvedDir,
        mirrorFrom: canonicalDir,
      });
    } else {
      const resolvedSig = signatureFor({
        id: `${id}/resolved`,
        title,
        subtitle,
        badge: 'Archived',
        date,
        accent,
        templateHash,
        kind: incident.kind,
      });
      const resolvedCachedPng = resolve(cacheDir, 'og-resolved.png');
      const resolvedCachedSig = resolve(cacheDir, 'sig-resolved');
      const resolvedCacheHit =
        existsSync(resolvedCachedPng) &&
        existsSync(resolvedCachedSig) &&
        readFileSync(resolvedCachedSig, 'utf8') === resolvedSig;
      if (resolvedCacheHit) {
        copyFileSync(resolvedCachedPng, resolve(resolvedDir, 'og.png'));
      } else {
        renders.push({
          id: `${id}/resolved`,
          html: fillTemplate(template, {
            id,
            title,
            subtitle,
            badge: 'Archived',
            date,
            accent,
            kind: incident.kind,
          }),
          outDir: resolvedDir,
          cacheDir,
          cachedPng: resolvedCachedPng,
          cachedSig: resolvedCachedSig,
          sig: resolvedSig,
        });
      }
    }
  }

  let rendered = 0;

  if (renders.length > 0) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });

    const pages = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, renders.length) }, () => ctx.newPage()),
    );
    // Render-pass first, then mirror-pass — a /resolved mirror that copies from
    // canonical needs the canonical render to have already happened. Splitting
    // by html != null gives that ordering without explicit dependency tracking.
    const realRenders = renders.filter((r) => r.html != null);
    const mirrorJobs = renders.filter((r) => r.html == null);

    let i = 0;
    await workerPool(realRenders, pages.length, async (item) => {
      const page = pages[i++ % pages.length];
      const out = resolve(item.outDir, 'og.png');
      await renderPng(page, item.html, out);
      mkdirSync(item.cacheDir, { recursive: true });
      copyFileSync(out, item.cachedPng);
      writeFileSync(item.cachedSig, item.sig);
      rendered++;
    });

    for (const item of mirrorJobs) {
      // Mirror = canonical was Archived already, so /resolved's PNG is identical.
      // The canonical PNG is now on disk (either freshly rendered above or copied
      // from cache earlier in the planning loop), so just copy it across.
      const src = resolve(item.mirrorFrom, 'og.png');
      const dst = resolve(item.outDir, 'og.png');
      if (existsSync(src)) copyFileSync(src, dst);
    }

    await browser.close();
  }

  // Sweep cache entries for events no longer in the payload so the cache
  // doesn't grow unboundedly. (Resolved incidents eventually age out of
  // alerts.json; their cached PNGs are no longer reachable.)
  let pruned = 0;
  for (const entry of readdirSync(CACHE)) {
    if (!seenIds.has(entry)) {
      rmSync(resolve(CACHE, entry), { recursive: true, force: true });
      pruned++;
    }
  }

  console.log(
    `prerender-events: ${incidents.size} events · ${rendered} rendered · ${pruned} pruned (concurrency=${CONCURRENCY})`,
  );
}

// Render helpers are exported so debugging/render-og.js can produce a single
// sample card through the exact production path (same accent, summary, template
// fill, and screenshot) instead of a drifting re-implementation. `main()` only
// runs when this file is invoked directly (the postbuild step), not on import.
export { accentFor, fillTemplate, formatCardDate, pickIncidents, renderPng, summarize, TEMPLATE };

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
