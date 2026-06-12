// Generate dist/data/alerts.csv — a flat CSV mirror of alerts.json for
// pandas / spreadsheet users who don't want to wrangle the JSON shape.
// Combines alerts and observations into one row per record with a `type`
// column to distinguish them. Columns are stable (defined in src/lib/csv.js,
// shared with the in-browser "Download filtered CSV" button), so a
// downstream pipeline can pin to this layout.
//
// Runs as a postbuild step alongside generate-feed.js / generate-sitemap.js.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsv } from '../src/lib/csv.js';
import { withRuntimeAliasesAll } from '../src/lib/incidents.js';
import { gateIncidents } from '../src/lib/metraGate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const OUT = resolve(DIST, 'data', 'alerts.csv');

function main() {
  if (!existsSync(DATA)) {
    console.warn(`generate-csv: ${DATA} missing — skipping`);
    return;
  }
  const raw = JSON.parse(readFileSync(DATA, 'utf8'));
  // The CSV mirror is Metra-aware (one flat row per record; the `kind` column
  // already distinguishes Metra rows), so opt in explicitly. The Node-default
  // gate stays CTA-only for the not-yet-Metra build outputs (OG-prerendered pages).
  raw.incidents = withRuntimeAliasesAll(gateIncidents(raw.incidents || [], true));
  const csv = buildCsv(raw.incidents);
  writeFileSync(OUT, csv);
  const rowCount = raw.incidents.reduce(
    (sum, inc) =>
      sum +
      (inc.official_alert || inc.cta ? 1 : 0) +
      (inc.detections || inc.observations || []).length,
    0,
  );
  console.log(`generate-csv: wrote ${rowCount} rows to ${OUT}`);
}

main();
