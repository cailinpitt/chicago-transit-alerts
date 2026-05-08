// Prerender per-event HTML stubs and OG images so social media crawlers
// (Twitter, Bluesky, Slack, etc.) get event-specific cards. Crawlers don't run
// JS; they just read meta tags from whatever HTML the URL serves. This script
// emits `dist/event/<id>/index.html` (clone of the SPA shell with rewritten
// OG meta) plus `dist/event/<id>/og.png` (1200x630, Playwright-rendered).
//
// Runs as a postbuild step. Requires `dist/data/alerts.json` to be present —
// it's copied from `public/data/` by Vite at build time.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BUS_ROUTE_NAMES } from '../src/lib/busRoutes.js';
import { TRAIN_LINES, normalizeTrainLine } from '../src/lib/ctaLines.js';
import { mergeMatchingIncidents } from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const SHELL = resolve(DIST, 'index.html');
const TEMPLATE = resolve(__dirname, 'og-event-template.html');

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
  if (incident.kind === 'train') {
    const route = normalizeTrainLine(
      incident.routes?.[0] ?? incident.line ?? '',
    );
    const line = TRAIN_LINES[route];
    if (line) {
      return {
        color: line.color,
        soft: softColor(line.color, 0.22),
        text: line.textColor,
        label: `${line.label} Line`,
      };
    }
  }
  if (incident.kind === 'bus') {
    const route = incident.routes?.[0] ?? incident.line ?? '';
    const name = BUS_ROUTE_NAMES[route] ?? BUS_ROUTE_NAMES[String(route)];
    return {
      ...BUS_ACCENT,
      label: name ? `#${route} ${name}` : `Bus #${route}`,
    };
  }
  return { ...BUS_ACCENT, label: 'CTA' };
}

function describeObservation(obs) {
  const signals = obs.signals?.length ? obs.signals : (obs.detection_source ? [obs.detection_source] : []);
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
  const list = phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return `Bot detected ${list} on this route.`;
}

function summarize(incident) {
  if (incident.headline) {
    return { title: incident.headline, subtitle: 'CTA service alert · archived on chicagotransitalerts.app' };
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

function buildHtmlStub(shell, { id, title, subtitle, accent }) {
  const url = `${SITE}/event/${id}`;
  const image = `${url}/og.png`;
  const ogTitle = `${accent.label} · ${title}`.slice(0, 200);
  const desc = subtitle.slice(0, 280);
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(ogTitle)} — CTA Alert History</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escAttr(url)}" />`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escAttr(desc)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escAttr(ogTitle)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escAttr(desc)}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${escAttr(url)}" />`)
    .replace(/<meta property="og:image"[^>]*>/g, `<meta property="og:image" content="${escAttr(image)}" />`)
    .replace(/<meta property="og:image:alt"[^>]*>/, `<meta property="og:image:alt" content="${escAttr(ogTitle)}" />`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${escAttr(ogTitle)}" />`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${escAttr(desc)}" />`)
    .replace(/<meta name="twitter:image"[^>]*>/g, `<meta name="twitter:image" content="${escAttr(image)}" />`)
    .replace(/<meta name="twitter:image:alt"[^>]*>/, `<meta name="twitter:image:alt" content="${escAttr(ogTitle)}" />`);
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

async function main() {
  if (!existsSync(DATA)) {
    console.warn(`prerender-events: ${DATA} missing — skipping (build copies public/data first)`);
    return;
  }
  const payload = JSON.parse(readFileSync(DATA, 'utf8'));
  const shell = readFileSync(SHELL, 'utf8');
  const template = readFileSync(TEMPLATE, 'utf8');

  const incidents = pickIncidents(payload);
  if (incidents.size === 0) {
    console.log('prerender-events: no incidents to prerender');
    return;
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  let count = 0;
  for (const [id, incident] of incidents) {
    const accent = accentFor(incident);
    const { title, subtitle } = summarize(incident);
    const badge = incident.active ? 'Active' : 'Archived';

    const outDir = resolve(DIST, 'event', id);
    mkdirSync(outDir, { recursive: true });

    // Per-event HTML stub (SPA still hydrates from this — only meta differs).
    writeFileSync(resolve(outDir, 'index.html'), buildHtmlStub(shell, { id, title, subtitle, accent }));

    // Per-event OG image.
    const html = fillTemplate(template, { id, title, subtitle, badge, accent });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({
      path: resolve(outDir, 'og.png'),
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    count++;
  }

  await browser.close();
  console.log(`prerender-events: wrote ${count} per-event stubs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
