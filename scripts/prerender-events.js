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
import { normalizeTrainLine, TRAIN_LINES } from '../src/lib/ctaLines.js';
import {
  formatRoutesLabel,
  mergeMatchingIncidents,
  normalizeAlertsPayload,
} from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const SHELL = resolve(DIST, 'index.html');
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

  // Accent color still derives from the first route — the card's left bar +
  // background tint is a single accent, not a gradient across N colors.
  if (incident.kind === 'train') {
    const route = normalizeTrainLine(routes[0] ?? '');
    const line = TRAIN_LINES[route];
    if (line) {
      return {
        color: line.color,
        soft: softColor(line.color, 0.22),
        text: line.textColor,
        label,
      };
    }
  }
  if (incident.kind === 'bus') {
    return { ...BUS_ACCENT, label };
  }
  return { ...BUS_ACCENT, label };
}

function describeObservation(obs) {
  const signals = obs.signals?.length
    ? obs.signals
    : obs.detection_source
      ? [obs.detection_source]
      : [];
  if (!signals.length) return 'Service disruption detected by bot.';
  const labels = {
    gap: 'gap',
    bunching: 'bunching',
    ghost: 'missing vehicles',
    'pulse-cold': 'service blackout',
    'pulse-held': 'vehicles stuck',
    roundup: 'multiple signals',
  };
  const phrases = signals.map((s) => labels[s] ?? s);
  const list =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return `Bot detected ${list} on this route.`;
}

function summarize(incident) {
  if (incident.headline) {
    return {
      title: incident.headline,
      subtitle: 'CTA service alert · archived on chicagotransitalerts.app',
    };
  }
  const accent = accentFor(incident);
  return {
    title: `Possible disruption · ${accent.label}`,
    subtitle: describeObservation(incident),
  };
}

function pickIncidents(payload) {
  // Mirror what the SPA shows: merged + standalone. We dedupe by event id so a
  // merged incident doesn't also produce a stub for its underlying alert.
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    payload.alerts ?? [],
    payload.observations ?? [],
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
      name: 'Chicago Transit Authority',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL' },
    };
  }
  ld.organizer = {
    '@type': 'Organization',
    name: 'CTA Alert History (unofficial)',
    url: SITE,
  };
  return JSON.stringify(ld);
}

function buildHtmlStub(shell, { id, title, subtitle, accent, incident }) {
  const url = `${SITE}/event/${id}`;
  const image = `${url}/og.png`;
  const ogTitle = `${accent.label} · ${title}`.slice(0, 200);
  const desc = subtitle.slice(0, 280);
  // Inject JSON-LD just before </head>. `<` inside the JSON has to be escaped
  // because </script> in a string literal would otherwise close the tag.
  const jsonLd = buildJsonLd(incident, { ogTitle, desc, url }).replaceAll('<', '\\u003c');
  const ldTag = `<script type="application/ld+json">${jsonLd}</script>`;
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(ogTitle)} — CTA Alert History</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escAttr(url)}" />`)
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
    .replace('</head>', `${ldTag}\n  </head>`);
}

function fillTemplate(tpl, fields) {
  return tpl
    .replaceAll('__ACCENT__', fields.accent.color)
    .replaceAll('__ACCENT_SOFT__', fields.accent.soft)
    .replaceAll('__ACCENT_TEXT__', fields.accent.text)
    .replaceAll('__LINE_LABEL__', escHtml(fields.accent.label))
    .replaceAll('__BADGE__', fields.badge)
    .replaceAll('__TITLE__', escHtml(fields.title))
    .replaceAll('__SUBTITLE__', escHtml(fields.subtitle))
    .replaceAll('__EVENT_ID__', escHtml(fields.id));
}

// Hash the inputs that affect the rendered PNG. If this is unchanged from the
// last build's signature, we can skip Playwright entirely for this event.
function signatureFor({ id, title, subtitle, badge, accent, templateHash }) {
  const h = createHash('sha256');
  h.update(JSON.stringify({ id, title, subtitle, badge, accent, templateHash }));
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
  // Normalize at read time so train short codes (`y`, `brn`, `org`, `p`, `g`)
  // get expanded to full names. Without this, formatRoutesLabel can't look
  // them up in TRAIN_LINES and the OG card / JSON-LD ends up with `y Line`
  // instead of `Yellow Line`.
  const payload = normalizeAlertsPayload(JSON.parse(readFileSync(DATA, 'utf8')));
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
  const renders = [];
  const seenIds = new Set();
  for (const [id, incident] of incidents) {
    seenIds.add(id);
    const accent = accentFor(incident);
    const { title, subtitle } = summarize(incident);
    const badge = incident.active ? 'Active' : 'Archived';
    const sig = signatureFor({ id, title, subtitle, badge, accent, templateHash });

    const outDir = resolve(DIST, 'event', id);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      resolve(outDir, 'index.html'),
      buildHtmlStub(shell, { id, title, subtitle, accent, incident }),
    );

    const cacheDir = resolve(CACHE, id);
    const cachedPng = resolve(cacheDir, 'og.png');
    const cachedSig = resolve(cacheDir, 'sig');
    const sigMatches =
      existsSync(cachedPng) && existsSync(cachedSig) && readFileSync(cachedSig, 'utf8') === sig;

    if (sigMatches) {
      copyFileSync(cachedPng, resolve(outDir, 'og.png'));
      continue;
    }

    renders.push({
      id,
      html: fillTemplate(template, { id, title, subtitle, badge, accent }),
      outDir,
      cacheDir,
      cachedPng,
      cachedSig,
      sig,
    });
  }

  let rendered = 0;
  const cached = incidents.size - renders.length;

  if (renders.length > 0) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });

    const pages = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, renders.length) }, () => ctx.newPage()),
    );
    let i = 0;
    await workerPool(renders, pages.length, async (item) => {
      const page = pages[i++ % pages.length];
      const out = resolve(item.outDir, 'og.png');
      await renderPng(page, item.html, out);
      mkdirSync(item.cacheDir, { recursive: true });
      copyFileSync(out, item.cachedPng);
      writeFileSync(item.cachedSig, item.sig);
      rendered++;
    });

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
    `prerender-events: ${rendered} rendered, ${cached} cache-hit, ${pruned} pruned (concurrency=${CONCURRENCY})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
