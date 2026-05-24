import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as incidentsLib from '../lib/incidents.js';
import { flattenIncidents } from '../lib/incidents.js';

// Regression guard for a class of bug that shipped to production once already:
// the incidents[] migration deleted `normalizeAlertsPayload` from
// src/lib/incidents.js, but five postbuild scripts (prerender-events,
// prerender-pages, generate-feed, generate-sitemap, generate-csv) still
// imported it. ESM named imports of a missing export throw at module load, so
// `npm run build`'s postbuild step crashed and no /event/<rkey> stubs shipped —
// every bot-posted archive link 404'd. CI's PR gate runs `npm test`/`npm run
// lint` but never `npm run build`, so nothing caught it before merge.
//
// These tests assert the contract those scripts depend on: every name they
// import from incidents.js is actually exported, and `flattenIncidents` (the
// sanctioned wire -> flat bridge they all use) returns the shape they read.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '../../scripts');
const LIB_SPECIFIER = '../src/lib/incidents.js';

// Pull the named imports a script pulls from incidents.js out of its source.
// Handles single- and multi-line `import { a, b } from '...'` blocks and
// strips `as` aliases down to the imported (left-hand) name.
function importedNamesFrom(source, specifier) {
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
    'g',
  );
  const names = [];
  for (const match of source.matchAll(re)) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function scriptsImportingIncidentsLib() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, source: readFileSync(resolve(SCRIPTS_DIR, f), 'utf8') }))
    .filter(({ source }) => source.includes(LIB_SPECIFIER));
}

describe('build scripts ↔ incidents.js exports', () => {
  const scripts = scriptsImportingIncidentsLib();

  it('finds the build scripts that depend on incidents.js', () => {
    // Sanity check the discovery itself — if this regex/glob silently matches
    // nothing, the per-script assertions below would vacuously pass.
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('$file imports only names incidents.js exports', ({ source }) => {
    const exported = new Set(Object.keys(incidentsLib));
    for (const name of importedNamesFrom(source, LIB_SPECIFIER)) {
      expect(exported, `incidents.js must export "${name}"`).toContain(name);
    }
  });
});

describe('flattenIncidents wire → flat contract', () => {
  const NOW = 1_000_000_000_000;
  const ALERT_URL = 'https://bsky.app/profile/did:plc:abc/post/3ml5idb536d2c';
  const OBS_URL = 'https://bsky.app/profile/did:plc:xyz/post/3mkuutqcneg2h';

  const incidents = [
    {
      id: '3ml5idb536d2c',
      kind: 'train',
      routes: ['red'],
      cta: {
        alert_id: 'a1',
        headline: 'Red Line Delays',
        first_seen_ts: NOW - 60 * 60_000,
        resolved_ts: NOW - 30 * 60_000,
        active: false,
        post_url: ALERT_URL,
      },
      observations: [
        {
          id: 1,
          kind: 'train',
          line: 'red',
          ts: NOW - 55 * 60_000,
          post_url: OBS_URL,
        },
      ],
    },
    {
      id: '3mkomsa7xhv2i',
      kind: 'bus',
      routes: ['22'],
      cta: null,
      observations: [{ id: 2, kind: 'bus', line: '22', ts: NOW - 10 * 60_000, post_url: 'x' }],
    },
  ];

  it('expands cta blocks into flat alerts the export scripts read', () => {
    const { alerts } = flattenIncidents(incidents);
    expect(alerts).toHaveLength(1); // only the incident with a cta block
    const [alert] = alerts;
    // Fields the scripts actually consume (csv rows, OG cards, sitemap rkeys).
    expect(alert).toMatchObject({
      kind: 'train',
      routes: ['red'],
      headline: 'Red Line Delays',
      post_url: ALERT_URL,
      active: false,
    });
  });

  it('emits one observation row per nested observation, tagged with its incident', () => {
    const { observations } = flattenIncidents(incidents);
    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o._incidentId)).toEqual(['3ml5idb536d2c', '3mkomsa7xhv2i']);
    expect(observations[0]).toMatchObject({ post_url: OBS_URL, line: 'red' });
  });

  it('tolerates a missing/empty incidents list', () => {
    expect(flattenIncidents([])).toEqual({ alerts: [], observations: [] });
    expect(flattenIncidents(undefined)).toEqual({ alerts: [], observations: [] });
  });
});
