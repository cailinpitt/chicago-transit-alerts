#!/usr/bin/env node
// Render a single event's OG card to a PNG so you can eyeball template/title
// changes without a full `npm run build` + postbuild over every event.
//
// It reuses the exact production render path exported from
// scripts/prerender-events.js (accent → summary → fillTemplate → chromium
// screenshot), so the sample card is byte-faithful to what the build emits —
// no drifting re-implementation.
//
// Usage:
//   node debugging/render-og.js --id 3mndpmuotdx2m
//   node debugging/render-og.js --id 3mndpmuotdx2m --variant resolved
//   node debugging/render-og.js --id 3mndpmuotdx2m --out tmp/card.png
//   node debugging/render-og.js --id 3mndpmuotdx2m --data public/data/alerts.json
//
// Data source: the live site's alerts.json by default (always current); pass
// --data <path> to render from a local snapshot (public/data or dist/data).

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  accentFor,
  fillTemplate,
  formatCardDate,
  pickIncidents,
  renderPng,
  summarize,
  TEMPLATE,
} from '../scripts/prerender-events.js';
import { flattenIncidents } from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// Public production feed by default; override with CTA_DATA_URL for a fork.
const LIVE = process.env.CTA_DATA_URL || 'https://chicagotransitalerts.app/data/alerts.json';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

async function loadPayload(dataArg) {
  let raw;
  if (dataArg) {
    raw = JSON.parse(readFileSync(resolve(ROOT, dataArg), 'utf8'));
  } else {
    const res = await fetch(LIVE);
    if (!res.ok) throw new Error(`fetch ${LIVE} → ${res.status}`);
    raw = await res.json();
  }
  return { ...raw, ...flattenIncidents(raw.incidents || []) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = args.id;
  if (!id) {
    console.error(
      'Usage: node debugging/render-og.js --id <eventId> [--variant resolved] [--out <path>] [--data <path>]',
    );
    process.exit(1);
  }
  const variant = args.variant === 'resolved' ? 'resolved' : 'canonical';
  const out = resolve(
    ROOT,
    args.out || `tmp/og-${id}${variant === 'resolved' ? '-resolved' : ''}.png`,
  );

  const payload = await loadPayload(args.data);
  const incident = pickIncidents(payload).get(id);
  if (!incident) {
    console.error(`No event with id "${id}" in ${args.data ? args.data : 'live alerts.json'}.`);
    console.error('The id is the rkey at the end of an /event/<id>/ URL.');
    process.exit(1);
  }

  const accent = accentFor(incident);
  const { title, subtitle } = summarize(incident);
  const date = formatCardDate(incident);
  // Mirrors prerender-events: canonical badge tracks live state; the /resolved
  // variant is always 'Archived' (the Bluesky-card-cache target).
  const badge = variant === 'resolved' ? 'Archived' : incident.active ? 'Active' : 'Archived';

  const template = readFileSync(TEMPLATE, 'utf8');
  const html = fillTemplate(template, { id, title, subtitle, badge, date, accent });

  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await renderPng(page, html, out);
  } finally {
    await browser.close();
  }

  console.log(`Wrote ${out}`);
  console.log(`  title:    ${title}`);
  console.log(`  subtitle: ${subtitle}`);
  console.log(`  badge:    ${badge} · date: ${date ?? '(none)'} · variant: ${variant}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
