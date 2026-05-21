// CSV row construction shared by the postbuild full-dataset export
// (`scripts/generate-csv.js`) and the in-browser "Download filtered CSV"
// button (`IncidentList`). Keeping this in one place means the on-disk
// columns and the user-downloaded columns can't drift.

import { observationSignals } from './incidents.js';

// Order chosen so the first columns identify the row, the middle columns
// describe what + where, and the trailing columns carry metadata.
export const CSV_COLUMNS = [
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
  // CTA's own posted EventStart/EventEnd (alerts only — observations don't
  // carry these). Date-only flags signal when CTA only provided a calendar
  // day; in that case the timestamp anchors to end-of-day Chicago time.
  'cta_event_start_ts', // ISO 8601 (UTC) or empty
  'cta_event_end_ts', // ISO 8601 (UTC) or empty
  'cta_event_start_is_date_only', // 'true' | 'false' | ''
  'cta_event_end_is_date_only', // 'true' | 'false' | ''
];

export function csvEscape(value) {
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

export function alertRow(a) {
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
        ? Math.round((a.duration_ms ?? a.resolved_ts - a.first_seen_ts) / 60_000)
        : '',
    active: a.active ? 'true' : 'false',
    post_url: a.post_url ?? '',
    resolved_post_url: a.resolved_reply_url ?? '',
    cta_event_start_ts: isoOrEmpty(a.cta_event_start_ts),
    cta_event_end_ts: isoOrEmpty(a.cta_event_end_ts),
    cta_event_start_is_date_only:
      a.cta_event_start_ts != null ? (a.cta_event_start_is_date_only ? 'true' : 'false') : '',
    cta_event_end_is_date_only:
      a.cta_event_end_ts != null ? (a.cta_event_end_is_date_only ? 'true' : 'false') : '',
  };
}

export function observationRow(o) {
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
      o.resolved_ts != null && o.ts != null
        ? Math.round((o.duration_ms ?? o.resolved_ts - o.ts) / 60_000)
        : '',
    active: o.active ? 'true' : 'false',
    post_url: o.post_url ?? '',
    resolved_post_url: o.resolved_post_url ?? '',
  };
}

function rowToCsv(row) {
  return CSV_COLUMNS.map((c) => csvEscape(row[c])).join(',');
}

// Build a complete CSV document for the given alerts + observations. Sorts
// newest-first so `head` of the file shows recent data, matching the SPA's
// list order.
/**
 * @param {Array<object>} alerts
 * @param {Array<object>} observations
 * @returns {string}
 */
export function buildCsv(alerts, observations) {
  const rows = [...(alerts ?? []).map(alertRow), ...(observations ?? []).map(observationRow)].sort(
    (a, b) => (b.first_seen_ts < a.first_seen_ts ? -1 : b.first_seen_ts > a.first_seen_ts ? 1 : 0),
  );
  const lines = [CSV_COLUMNS.join(','), ...rows.map(rowToCsv)];
  return `${lines.join('\n')}\n`;
}
