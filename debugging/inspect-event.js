#!/usr/bin/env node
// Inspect one event from the wire feed: print its full incident JSON, and
// (with --titles) the strings the UI derives from it — so you can answer
// "what does this event actually contain?" and "what will its title read as?"
// without spinning up the SPA.
//
// Usage:
//   node debugging/inspect-event.js --id 3mndpmuotdx2m
//   node debugging/inspect-event.js --id 3mndpmuotdx2m --titles
//   node debugging/inspect-event.js --id 3mndpmuotdx2m --data public/data/alerts.json
//
// Data source: the live site's alerts.json by default; pass --data <path> for a
// local snapshot. The --titles strings use the same pure helpers the app does
// (lib/incidents.js, lib/stations.js); the in-app title mirrors describeText in
// components/event/incidentText.jsx (a .jsx file the renderers can't import).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  botSummaryText,
  findIncidentById,
  formatRoutesLabel,
  splitObservations,
} from '../src/lib/incidents.js';
import { displayStationName } from '../src/lib/stations.js';

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

async function loadRaw(dataArg) {
  if (dataArg) return JSON.parse(readFileSync(resolve(ROOT, dataArg), 'utf8'));
  const res = await fetch(LIVE);
  if (!res.ok) throw new Error(`fetch ${LIVE} → ${res.status}`);
  return res.json();
}

// Plain-text in-app title — mirrors describeText() in incidentText.jsx, which
// can't be imported here (it's a .jsx file pulling in React components).
function inAppTitle(incident) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    const seg = `${displayStationName(primary.from_station)} → ${displayStationName(primary.to_station)}`;
    return primary.direction_label ? `${seg} (${primary.direction_label})` : seg;
  }
  return botSummaryText(incident);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = args.id;
  if (!id) {
    console.error(
      'Usage: node debugging/inspect-event.js --id <eventId> [--titles] [--data <path>]',
    );
    process.exit(1);
  }
  const raw = await loadRaw(args.data);
  const incident = findIncidentById(raw.incidents || [], id);
  if (!incident) {
    console.error(`No event with id "${id}" in ${args.data ? args.data : 'live alerts.json'}.`);
    console.error('The id is the rkey at the end of an /event/<id>/ URL.');
    process.exit(1);
  }

  if (args.titles) {
    const routes = Array.isArray(incident.routes) ? incident.routes : [];
    console.log(`event:        ${incident.id}`);
    console.log(`line/route:   ${formatRoutesLabel(incident.kind, routes)}`);
    console.log(`in-app title: ${inAppTitle(incident)}`);
    console.log(`bot summary:  ${botSummaryText(incident)}`);
    console.log(
      `source:       ${incident.cta ? (incident.observations?.length ? 'merged (CTA+bot)' : 'CTA') : 'bot'}`,
    );
    console.log(`active:       ${!!incident.active}`);
    return;
  }

  console.log(JSON.stringify(incident, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
