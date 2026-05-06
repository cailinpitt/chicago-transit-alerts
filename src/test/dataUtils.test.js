import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  filterIncidents,
  mergeMatchingIncidents,
  buildIncidentsByDay,
  computeSummaryStats,
} from '../lib/dataUtils.js';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('returns null for falsy input', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });

  it('formats minutes only', () => {
    expect(formatDuration(5 * 60_000)).toBe('~5m');
    expect(formatDuration(59 * 60_000)).toBe('~59m');
  });

  it('formats whole hours', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('~2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(90 * 60_000)).toBe('~1h 30m');
  });
});

// ---------------------------------------------------------------------------
// filterIncidents
// ---------------------------------------------------------------------------
const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const makeAlert = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW - DAY,
  active: false,
  resolved_ts: NOW - DAY + 30 * 60_000,
  ...overrides,
});

const makeObs = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  ts: NOW - DAY,
  active: false,
  resolved_ts: NOW - DAY + 30 * 60_000,
  ...overrides,
});

describe('filterIncidents', () => {
  it('returns everything when no filters are set', () => {
    const alerts = [makeAlert()];
    const obs = [makeObs()];
    const result = filterIncidents(alerts, obs);
    expect(result.alerts).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
  });

  it('filters alerts by train line', () => {
    const alerts = [makeAlert({ routes: ['red'] }), makeAlert({ alert_id: 2, routes: ['blue'] })];
    const { alerts: out } = filterIncidents(alerts, [], { lines: ['red'] });
    expect(out).toHaveLength(1);
    expect(out[0].routes).toContain('red');
  });

  it('filters train observations by line', () => {
    const obs = [makeObs({ line: 'red' }), makeObs({ id: 2, line: 'blue' })];
    const { observations: out } = filterIncidents([], obs, { lines: ['red'] });
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe('red');
  });

  it('hides old resolved incidents when startTs is set', () => {
    const old = makeAlert({ first_seen_ts: NOW - 10 * DAY, resolved_ts: NOW - 9 * DAY });
    const recent = makeAlert({ alert_id: 2, first_seen_ts: NOW - DAY });
    const { alerts: out } = filterIncidents([old, recent], [], { startTs: NOW - 5 * DAY });
    expect(out).toHaveLength(1);
    expect(out[0].alert_id).toBe(2);
  });

  it('keeps active incidents regardless of startTs', () => {
    const active = makeAlert({ first_seen_ts: NOW - 10 * DAY, resolved_ts: null, active: true });
    const { alerts: out } = filterIncidents([active], [], { startTs: NOW - 5 * DAY });
    expect(out).toHaveLength(1);
  });

  it('hides bus observations when showBus is false', () => {
    const bus = makeObs({ id: 2, kind: 'bus', line: '66' });
    const train = makeObs({ id: 3, kind: 'train', line: 'red' });
    const { observations: out } = filterIncidents([], [bus, train], { showBus: false });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('train');
  });

  it('shows bus observations independently of train line filter', () => {
    const bus = makeObs({ id: 2, kind: 'bus', line: '66' });
    const { observations: out } = filterIncidents([], [bus], { lines: ['red'], showBus: true });
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeMatchingIncidents
// ---------------------------------------------------------------------------
const makeAlertForMerge = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  headline: 'Red Line Delays',
  first_seen_ts: NOW,
  last_seen_ts: NOW + 20 * 60_000,
  resolved_ts: NOW + 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/a',
  ...overrides,
});

const makeObsForMerge = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'Jarvis',
  to_station: '95th/Dan Ryan',
  ts: NOW + 5 * 60_000,
  resolved_ts: NOW + 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/b',
  ...overrides,
});

describe('mergeMatchingIncidents', () => {
  it('merges an alert and observation on the same line within the time window', () => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [makeAlertForMerge()],
      [makeObsForMerge()],
    );
    expect(merged).toHaveLength(1);
    expect(standaloneAlerts).toHaveLength(0);
    expect(standaloneObs).toHaveLength(0);
    expect(merged[0].headline).toBe('Red Line Delays');
    expect(merged[0].from_station).toBe('Jarvis');
  });

  it('does not merge when lines differ', () => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [makeAlertForMerge({ routes: ['blue'] })],
      [makeObsForMerge({ line: 'red' })],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });

  it('does not merge when observation is outside the time window', () => {
    const farObs = makeObsForMerge({ ts: NOW + 5 * 60 * 60_000 }); // 5 hours later
    const { merged } = mergeMatchingIncidents([makeAlertForMerge()], [farObs]);
    expect(merged).toHaveLength(0);
  });

  it('does not merge bus alerts', () => {
    const busAlert = makeAlertForMerge({ kind: 'bus', routes: ['66'] });
    const busObs = makeObsForMerge({ kind: 'bus', line: '66' });
    const { merged } = mergeMatchingIncidents([busAlert], [busObs]);
    expect(merged).toHaveLength(0);
  });

  it('each alert merges with at most one observation', () => {
    const obs1 = makeObsForMerge({ id: 1, ts: NOW + 1 * 60_000 });
    const obs2 = makeObsForMerge({ id: 2, ts: NOW + 2 * 60_000 });
    const { merged, standaloneObs } = mergeMatchingIncidents([makeAlertForMerge()], [obs1, obs2]);
    expect(merged).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildIncidentsByDay
// ---------------------------------------------------------------------------
describe('buildIncidentsByDay', () => {
  it('puts a single-day alert in the correct day bucket', () => {
    const alert = {
      kind: 'train',
      routes: ['red'],
      first_seen_ts: NOW - DAY, // 1 day ago
      resolved_ts: NOW - DAY + 60 * 60_000,
      active: false,
    };
    const result = buildIncidentsByDay([alert], [], 7, NOW);
    expect(result.red[1]).toBe(1); // dayIdx 1 = yesterday
  });

  it('counts an incident that spans multiple days in each day', () => {
    const alert = {
      kind: 'train',
      routes: ['blue'],
      first_seen_ts: NOW - 3 * DAY,
      resolved_ts: NOW - DAY,
      active: false,
    };
    const result = buildIncidentsByDay([alert], [], 7, NOW);
    expect(result.blue[1]).toBe(1);
    expect(result.blue[2]).toBe(1);
    expect(result.blue[3]).toBe(1);
  });

  it('ignores bus observations', () => {
    const obs = { kind: 'bus', line: '66', ts: NOW - DAY, resolved_ts: null };
    const result = buildIncidentsByDay([], [obs], 7, NOW);
    expect(result['66']).toBeUndefined();
  });

  it('counts a matching alert+observation as one incident (no double-counting)', () => {
    // Alert and obs are close in time — they will be merged into a single incident.
    const base = NOW - 2 * DAY;
    const alert = { kind: 'train', routes: ['g'], first_seen_ts: base, resolved_ts: base + 30 * 60_000 };
    const obs = { kind: 'train', line: 'g', ts: base + 60 * 60_000, resolved_ts: base + 90 * 60_000 };
    const result = buildIncidentsByDay([alert], [obs], 7, NOW);
    expect(result.g[2]).toBe(1);
  });

  it('counts two distinct non-overlapping incidents separately', () => {
    // Two alerts on the same line, both within the same Chicago calendar day.
    const base = NOW - 2 * DAY;
    const alert1 = { kind: 'train', routes: ['g'], first_seen_ts: base, resolved_ts: base + 30 * 60_000 };
    const alert2 = { kind: 'train', routes: ['g'], first_seen_ts: base + 60 * 60_000, resolved_ts: base + 90 * 60_000 };
    const result = buildIncidentsByDay([alert1, alert2], [], 7, NOW);
    expect(result.g[2]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeSummaryStats
// ---------------------------------------------------------------------------
describe('computeSummaryStats', () => {
  it('returns zeros and null leader for empty data', () => {
    const r = computeSummaryStats([], [], NOW);
    expect(r).toEqual({
      activeCount: 0,
      weeklyCount: 0,
      mostAffectedKind: null,
      mostAffectedId: null,
      mostAffectedCount: 0,
    });
  });

  it('counts active incidents across alerts and observations', () => {
    const alerts = [makeAlert({ active: true })];
    const obs = [makeObs({ active: true, id: 99 })];
    // Alert and obs are both red and close in time → merge into one incident.
    expect(computeSummaryStats(alerts, obs, NOW).activeCount).toBe(1);
  });

  it('counts incidents within the last 7 days', () => {
    const recent = makeAlert({ first_seen_ts: NOW - DAY });
    const old = makeAlert({ alert_id: 2, first_seen_ts: NOW - 30 * DAY });
    expect(computeSummaryStats([recent, old], [], NOW).weeklyCount).toBe(1);
  });

  it('picks the train line with the most incidents in the last 30 days', () => {
    const alerts = [
      makeAlert({ alert_id: 1, routes: ['red'], first_seen_ts: NOW - 1 * DAY }),
      makeAlert({ alert_id: 2, routes: ['red'], first_seen_ts: NOW - 5 * DAY }),
      makeAlert({ alert_id: 3, routes: ['blue'], first_seen_ts: NOW - 10 * DAY }),
      makeAlert({ alert_id: 4, routes: ['red'], first_seen_ts: NOW - 60 * DAY }), // outside 30d
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.mostAffectedKind).toBe('train');
    expect(r.mostAffectedId).toBe('red');
    expect(r.mostAffectedCount).toBe(2);
  });

  it('picks a bus route when it outpaces every train line', () => {
    const alerts = [
      makeAlert({ alert_id: 1, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 1 * DAY }),
      makeAlert({ alert_id: 2, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 2 * DAY }),
      makeAlert({ alert_id: 3, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 3 * DAY }),
      makeAlert({ alert_id: 4, kind: 'train', routes: ['red'], first_seen_ts: NOW - 4 * DAY }),
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.mostAffectedKind).toBe('bus');
    expect(r.mostAffectedId).toBe('66');
    expect(r.mostAffectedCount).toBe(3);
  });

  it('does not double-count a merged alert+observation in weeklyCount', () => {
    const alert = makeAlert({ first_seen_ts: NOW - DAY, routes: ['red'] });
    const obs = makeObs({ ts: NOW - DAY + 30 * 60_000, line: 'red' });
    expect(computeSummaryStats([alert], [obs], NOW).weeklyCount).toBe(1);
  });
});
