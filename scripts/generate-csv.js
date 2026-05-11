// Generate dist/data/alerts.csv — a flat CSV mirror of alerts.json for
// pandas / spreadsheet users who don't want to wrangle the JSON shape.
// Combines alerts and observations into one row per record with a `type`
// column to distinguish them. Columns are stable, so a downstream pipeline
// can pin to this layout.
//
// Runs as a postbuild step alongside generate-feed.js / generate-sitemap.js.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAlertsPayload, observationSignals } from '../src/lib/incidents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const OUT = resolve(DIST, 'data', 'alerts.csv');

// Order chosen so the first columns identify the row, the middle columns
// describe what + where, and the trailing columns carry metadata.
const COLUMNS = [
  'type', // 'alert' | 'observation'
  'id', // alert_id (alerts) or `obs-N` (observations)
  'kind', // 'train' | 'bus'
  'routes', // semicolon-separated train line keys or bus route ids
  'headline', // alerts only
  'detection_source', // observations only ('gap', 'pulse-cold', etc.)
  'signals', // observations only, semicolon-separated
  'from_station',
  'to_station',
  'direction',
  'first_seen_ts', // ISO 8601 (UTC)
  'resolved_ts', // ISO 8601 (UTC) or empty
  'duration_minutes', // resolved_ts - first_seen_ts in minutes, blank when unresolved
  'active', // 'true' | 'false'
  'post_url',
  'resolved_post_url',
];

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  // Wrap in quotes when the field contains anything CSV-meaningful. RFC 4180
  // says any double quote inside a quoted field is escaped by doubling it.
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function isoOrEmpty(ms) {
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

function alertRow(a) {
  return {
    type: 'alert',
    id: a.alert_id,
    kind: a.kind,
    routes: (a.routes ?? []).join(';'),
    headline: a.headline ?? '',
    detection_source: '',
    signals: '',
    from_station: a.affected_from_station ?? '',
    to_station: a.affected_to_station ?? '',
    direction: a.affected_direction ?? '',
    first_seen_ts: isoOrEmpty(a.first_seen_ts),
    resolved_ts: isoOrEmpty(a.resolved_ts),
    duration_minutes:
      a.resolved_ts != null && a.first_seen_ts != null
        ? Math.round((a.resolved_ts - a.first_seen_ts) / 60_000)
        : '',
    active: a.active ? 'true' : 'false',
    post_url: a.post_url ?? '',
    resolved_post_url: a.resolved_reply_url ?? '',
  };
}

function observationRow(o) {
  return {
    type: 'observation',
    id: `obs-${o.id}`,
    kind: o.kind,
    routes: o.line ?? '',
    headline: '',
    detection_source: o.detection_source ?? '',
    signals: observationSignals(o).join(';'),
    from_station: o.from_station ?? '',
    to_station: o.to_station ?? '',
    direction: o.direction ?? '',
    first_seen_ts: isoOrEmpty(o.ts),
    resolved_ts: isoOrEmpty(o.resolved_ts),
    duration_minutes:
      o.resolved_ts != null && o.ts != null ? Math.round((o.resolved_ts - o.ts) / 60_000) : '',
    active: o.active ? 'true' : 'false',
    post_url: o.post_url ?? '',
    resolved_post_url: o.resolved_post_url ?? '',
  };
}

function rowToCsv(row) {
  return COLUMNS.map((c) => csvEscape(row[c])).join(',');
}

function main() {
  if (!existsSync(DATA)) {
    console.warn(`generate-csv: ${DATA} missing — skipping`);
    return;
  }
  const payload = normalizeAlertsPayload(JSON.parse(readFileSync(DATA, 'utf8')));

  // Sort newest-first so a `head` of the CSV shows recent data, matching the
  // way the SPA orders the incident list.
  const rows = [
    ...(payload.alerts ?? []).map(alertRow),
    ...(payload.observations ?? []).map(observationRow),
  ].sort((a, b) =>
    b.first_seen_ts < a.first_seen_ts ? -1 : b.first_seen_ts > a.first_seen_ts ? 1 : 0,
  );

  const lines = [COLUMNS.join(','), ...rows.map(rowToCsv)];
  writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`generate-csv: wrote ${rows.length} rows to ${OUT}`);
}

main();
