// CSV row construction shared by the postbuild full-dataset export
// (`scripts/generate-csv.js`) and the in-browser "Download filtered CSV"
// button (`IncidentList`). Mirrors the public alerts.json v2 concepts.

import {
  incidentAgency,
  incidentDetections,
  incidentLifecycle,
  incidentMode,
  officialAlert,
} from './incidents.js';

export const CSV_COLUMNS = [
  'record_type',
  'incident_id',
  'agency',
  'mode',
  'routes',
  'source',
  'status_type',
  'headline',
  'description',
  'from_station',
  'to_station',
  'stations',
  'direction',
  'direction_label',
  'first_seen_ts',
  'onset_ts',
  'resolved_ts',
  'duration_minutes',
  'active',
  'post_url',
  'resolved_post_url',
];

export function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function isoOrEmpty(ms) {
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

function durationMinutes(lifecycle) {
  if (!lifecycle) return '';
  if (lifecycle.duration_ms != null) return Math.round(lifecycle.duration_ms / 60_000);
  if (lifecycle.resolved_ts != null && lifecycle.first_seen_ts != null) {
    return Math.round(
      (lifecycle.resolved_ts - (lifecycle.onset_ts ?? lifecycle.first_seen_ts)) / 60_000,
    );
  }
  return '';
}

function officialRow(incident, alert) {
  const scope = alert.scope ?? {
    from_station: alert.affected_from_station ?? null,
    to_station: alert.affected_to_station ?? null,
    stations: alert.affected_stations ?? [],
    mentioned_stations: alert.mentioned_stations ?? [],
    direction: alert.affected_direction ?? null,
  };
  const lifecycle =
    alert.lifecycle ??
    incidentLifecycle({
      first_seen_ts: alert.first_seen_ts,
      resolved_ts: alert.resolved_ts,
      active: alert.active,
      duration_ms: alert.duration_ms,
    });
  return {
    record_type: 'official_alert',
    incident_id: incident.id,
    agency: incidentAgency(incident),
    mode: incidentMode(incident),
    routes: (incident.routes ?? []).join(';'),
    source: 'official',
    status_type: incident.status?.type ?? incident.metra_status?.source ?? '',
    headline: alert.headline ?? '',
    description: alert.description ?? alert.short_description ?? '',
    from_station: scope.from_station ?? '',
    to_station: scope.to_station ?? '',
    stations: (scope.stations?.length ? scope.stations : (scope.mentioned_stations ?? [])).join(
      ';',
    ),
    direction: scope.direction ?? '',
    direction_label: '',
    first_seen_ts: isoOrEmpty(lifecycle.first_seen_ts),
    onset_ts: '',
    resolved_ts: isoOrEmpty(lifecycle.resolved_ts),
    duration_minutes: durationMinutes(lifecycle),
    active: lifecycle.active ? 'true' : 'false',
    post_url: alert.post_url ?? '',
    resolved_post_url: alert.resolved_reply_url ?? '',
  };
}

function detectionRow(incident, detection) {
  const scope = detection.scope ?? {
    from_station: detection.from_station ?? null,
    to_station: detection.to_station ?? null,
    stations: detection.stations ?? [],
    direction: detection.direction ?? null,
    direction_label: detection.direction_label ?? null,
  };
  const lifecycle = detection.lifecycle ?? {
    first_seen_ts: detection.ts,
    onset_ts: detection.onset_ts,
    resolved_ts: detection.resolved_ts,
    active: detection.active,
    duration_ms: detection.duration_ms,
  };
  return {
    record_type: 'detection',
    incident_id: incident.id,
    agency: incidentAgency(incident),
    mode: incidentMode(incident),
    routes: (incident.routes ?? []).join(';'),
    source: detection.source ?? detection.detection_source ?? '',
    status_type: incident.status?.type ?? incident.metra_status?.source ?? '',
    headline: '',
    description: detection.description ?? detection.bot_description ?? '',
    from_station: scope.from_station ?? '',
    to_station: scope.to_station ?? '',
    stations: (scope.stations ?? []).join(';'),
    direction: scope.direction ?? '',
    direction_label: scope.direction_label ?? '',
    first_seen_ts: isoOrEmpty(lifecycle.first_seen_ts),
    onset_ts: isoOrEmpty(lifecycle.onset_ts),
    resolved_ts: isoOrEmpty(lifecycle.resolved_ts),
    duration_minutes: durationMinutes(lifecycle),
    active: lifecycle.active ? 'true' : 'false',
    post_url: detection.post_url ?? '',
    resolved_post_url: detection.resolved_post_url ?? '',
  };
}

function rowToCsv(row) {
  return CSV_COLUMNS.map((c) => csvEscape(row[c])).join(',');
}

export function buildCsv(incidents) {
  const rows = [];
  for (const incident of incidents ?? []) {
    const alert = officialAlert(incident);
    if (alert) rows.push(officialRow(incident, alert));
    for (const detection of incidentDetections(incident))
      rows.push(detectionRow(incident, detection));
  }
  rows.sort((a, b) =>
    b.first_seen_ts < a.first_seen_ts ? -1 : b.first_seen_ts > a.first_seen_ts ? 1 : 0,
  );
  return `${[CSV_COLUMNS.join(','), ...rows.map(rowToCsv)].join('\n')}\n`;
}
