import { describe, expect, it } from 'vitest';
import {
  buildDailyTrend,
  buildHourOfWeek,
  buildIncidentsByDay,
  buildSignalsByLine,
  computeSummaryStats,
} from '../lib/aggregate.js';
import { formatDuration } from '../lib/format.js';
import {
  filterIncidents,
  findRelatedIncidents,
  mergeMatchingIncidents,
  observationSignals,
} from '../lib/incidents.js';

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

  // selectedDay narrows to a single Chicago calendar day. Reference day is the
  // UTC midnight of NOW's Chicago day; helpers below construct timestamps
  // relative to it.
  describe('selectedDay', () => {
    // chicagoDayUTC of NOW (1e12) lands on 2001-09-09 UTC.
    const dayUtc = Date.UTC(2001, 8, 9);
    const onDayTs = dayUtc + 12 * 60 * 60_000; // noon UTC, well within the day

    it('keeps incidents that started on the pinned day', () => {
      const a = makeAlert({ first_seen_ts: onDayTs, resolved_ts: onDayTs + 60_000 });
      const { alerts: out } = filterIncidents([a], [], { selectedDay: dayUtc, now: NOW });
      expect(out).toHaveLength(1);
    });

    it('drops incidents from a different day', () => {
      const earlier = makeAlert({
        first_seen_ts: onDayTs - 3 * DAY,
        resolved_ts: onDayTs - 3 * DAY + 60_000,
      });
      const { alerts: out } = filterIncidents([earlier], [], { selectedDay: dayUtc, now: NOW });
      expect(out).toHaveLength(0);
    });

    it('keeps active incidents whose span crosses the pinned day', () => {
      // Started 2 days before the pinned day, still active.
      const active = makeAlert({
        first_seen_ts: onDayTs - 2 * DAY,
        resolved_ts: null,
        active: true,
      });
      const { alerts: out } = filterIncidents([active], [], {
        selectedDay: dayUtc,
        now: onDayTs + 60_000,
      });
      expect(out).toHaveLength(1);
    });
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

  it('merges bus alert and observation on the same route', () => {
    const busAlert = makeAlertForMerge({ kind: 'bus', routes: ['66'] });
    const busObs = makeObsForMerge({ kind: 'bus', line: '66' });
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [busAlert],
      [busObs],
    );
    expect(merged).toHaveLength(1);
    expect(standaloneAlerts).toHaveLength(0);
    expect(standaloneObs).toHaveLength(0);
    expect(merged[0].routes).toEqual(['66']);
  });

  it('does not merge across kinds (train alert with bus obs of same key)', () => {
    // Defensive: route/line key spaces are disjoint in practice, but a stray
    // collision shouldn't merge a train alert with a bus observation.
    const alert = makeAlertForMerge({ kind: 'train', routes: ['1'] });
    const obs = makeObsForMerge({ kind: 'bus', line: '1' });
    const { merged } = mergeMatchingIncidents([alert], [obs]);
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
    const alert = {
      kind: 'train',
      routes: ['green'],
      first_seen_ts: base,
      resolved_ts: base + 30 * 60_000,
    };
    const obs = {
      kind: 'train',
      line: 'green',
      ts: base + 60 * 60_000,
      resolved_ts: base + 90 * 60_000,
    };
    const result = buildIncidentsByDay([alert], [obs], 7, NOW);
    expect(result.green[2]).toBe(1);
  });

  it('counts two distinct non-overlapping incidents separately', () => {
    // Two alerts on the same line, both within the same Chicago calendar day.
    const base = NOW - 2 * DAY;
    const alert1 = {
      kind: 'train',
      routes: ['green'],
      first_seen_ts: base,
      resolved_ts: base + 30 * 60_000,
    };
    const alert2 = {
      kind: 'train',
      routes: ['green'],
      first_seen_ts: base + 60 * 60_000,
      resolved_ts: base + 90 * 60_000,
    };
    const result = buildIncidentsByDay([alert1, alert2], [], 7, NOW);
    expect(result.green[2]).toBe(2);
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
      quietestLineId: null,
      quietestLineDays: 0,
    });
  });

  it('quietest line picks the train line with the oldest most-recent incident', () => {
    const alerts = [
      makeAlert({ alert_id: 1, routes: ['red'], first_seen_ts: NOW - 1 * DAY }),
      makeAlert({ alert_id: 2, routes: ['blue'], first_seen_ts: NOW - 5 * DAY }),
      makeAlert({ alert_id: 3, routes: ['green'], first_seen_ts: NOW - 12 * DAY }),
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.quietestLineId).toBe('green');
    expect(r.quietestLineDays).toBe(12);
  });

  it('quietest line ignores lines with no incidents in the dataset', () => {
    // Only Red has an incident; the seven other lines have no data → can't
    // claim a streak. Quietest reflects only lines we have evidence for.
    const alerts = [makeAlert({ routes: ['red'], first_seen_ts: NOW - 3 * DAY })];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.quietestLineId).toBe('red');
    expect(r.quietestLineDays).toBe(3);
  });

  it('quietest line ignores buses', () => {
    const alerts = [
      makeAlert({ alert_id: 1, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 60 * DAY }),
      makeAlert({ alert_id: 2, routes: ['red'], first_seen_ts: NOW - 4 * DAY }),
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.quietestLineId).toBe('red');
    expect(r.quietestLineDays).toBe(4);
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

// ---------------------------------------------------------------------------
// observationSignals
// ---------------------------------------------------------------------------
describe('observationSignals', () => {
  it('returns the signals array for roundup observations', () => {
    const obs = { detection_source: 'roundup', signals: ['gap', 'bunching'] };
    expect(observationSignals(obs)).toEqual(['gap', 'bunching']);
  });

  it('returns [detection_source] for single-signal observations', () => {
    expect(observationSignals({ detection_source: 'gap' })).toEqual(['gap']);
  });

  it('returns [] when neither field is present', () => {
    expect(observationSignals({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterIncidents — signal filter
// ---------------------------------------------------------------------------
describe('filterIncidents search', () => {
  it('matches alert headlines case-insensitively', () => {
    const a1 = makeAlert({ alert_id: 1, headline: 'Red Line Delays at Howard' });
    const a2 = makeAlert({ alert_id: 2, headline: 'Blue Line Delay near Forest Park' });
    const r = filterIncidents([a1, a2], [], { search: 'howard' });
    expect(r.alerts.map((a) => a.alert_id)).toEqual([1]);
  });

  it('matches observation from/to stations and direction', () => {
    const o1 = makeObs({ id: 1, from_station: 'Polk', to_station: 'Ashland' });
    const o2 = makeObs({ id: 2, from_station: 'Belmont', to_station: 'Howard' });
    const r = filterIncidents([], [o1, o2], { search: 'howard' });
    expect(r.observations.map((o) => o.id)).toEqual([2]);
  });

  it('matches bus route numbers', () => {
    const o = makeObs({ id: 1, kind: 'bus', line: '66' });
    const r = filterIncidents([], [o], { search: '66' });
    expect(r.observations).toHaveLength(1);
  });

  it('returns everything when search is whitespace-only', () => {
    const a = makeAlert({ headline: 'whatever' });
    const r = filterIncidents([a], [], { search: '   ' });
    expect(r.alerts).toHaveLength(1);
  });

  it('matches train line by user-visible label even when key differs', () => {
    // 'g' is the line key for Green; without label-matching, "green" would
    // never find Green Line incidents.
    const o = makeObs({ id: 1, line: 'green', from_station: null, to_station: null });
    const r = filterIncidents([], [o], { search: 'green' });
    expect(r.observations).toHaveLength(1);
  });

  it('matches bus route by name (e.g. "Chicago" → route 66)', () => {
    const o = makeObs({
      id: 1,
      kind: 'bus',
      line: '66',
      from_station: null,
      to_station: null,
    });
    const r = filterIncidents([], [o], { search: 'chicago' });
    expect(r.observations).toHaveLength(1);
  });

  it('matches alerts via their line label', () => {
    const a = makeAlert({ alert_id: 1, routes: ['brown'], headline: 'Service issue' });
    const r = filterIncidents([a], [], { search: 'brown' });
    expect(r.alerts).toHaveLength(1);
  });

  it('matches "red line" and "Brown Line" conversational forms', () => {
    const red = makeObs({ id: 1, line: 'red', from_station: null, to_station: null });
    const brn = makeObs({ id: 2, line: 'brown', from_station: null, to_station: null });
    expect(filterIncidents([], [red], { search: 'red line' }).observations).toHaveLength(1);
    expect(filterIncidents([], [brn], { search: 'Brown Line' }).observations).toHaveLength(1);
  });

  it('matches signal labels (e.g. "headway gaps" → gap observations)', () => {
    const gapObs = makeObs({
      id: 1,
      detection_source: 'gap',
      from_station: null,
      to_station: null,
    });
    const ghostObs = makeObs({
      id: 2,
      detection_source: 'ghost',
      from_station: null,
      to_station: null,
    });
    const r = filterIncidents([], [gapObs, ghostObs], { search: 'headway gaps' });
    expect(r.observations.map((o) => o.id)).toEqual([1]);
  });

  it('matches signal labels for roundup observations via signals array', () => {
    const o = makeObs({
      id: 1,
      detection_source: 'roundup',
      signals: ['bunching', 'gap'],
      from_station: null,
      to_station: null,
    });
    expect(filterIncidents([], [o], { search: 'bunching' }).observations).toHaveLength(1);
  });

  it('matches "route 66" for bus observations', () => {
    const o = makeObs({
      id: 1,
      kind: 'bus',
      line: '66',
      from_station: null,
      to_station: null,
    });
    expect(filterIncidents([], [o], { search: 'route 66' }).observations).toHaveLength(1);
    expect(filterIncidents([], [o], { search: '#66' }).observations).toHaveLength(1);
  });
});

describe('filterIncidents signal filter', () => {
  it('keeps only observations whose signals overlap the selected set', () => {
    const obsGap = makeObs({ id: 1, detection_source: 'gap' });
    const obsBunching = makeObs({ id: 2, detection_source: 'bunching' });
    const obsRoundup = makeObs({ id: 3, detection_source: 'roundup', signals: ['ghost', 'gap'] });
    const r = filterIncidents([], [obsGap, obsBunching, obsRoundup], { signals: ['gap'] });
    expect(r.observations.map((o) => o.id).sort()).toEqual([1, 3]);
  });

  it('drops standalone alerts when a signal filter is active', () => {
    const r = filterIncidents([makeAlert()], [makeObs({ detection_source: 'gap' })], {
      signals: ['gap'],
    });
    expect(r.alerts).toHaveLength(0);
    expect(r.observations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildHourOfWeek
// ---------------------------------------------------------------------------
describe('buildHourOfWeek', () => {
  it('returns an empty 7×24 grid for empty input', () => {
    const r = buildHourOfWeek([], []);
    expect(r.grid).toHaveLength(7);
    expect(r.grid[0]).toHaveLength(24);
    expect(r.maxCount).toBe(0);
    expect(r.total).toBe(0);
  });

  it('counts incidents into their start-time bucket', () => {
    // 2026-01-05 is a Monday in Chicago (UTC-6).
    const monday3pmCT = Date.UTC(2026, 0, 5, 21, 0); // 3pm CT = 21:00 UTC
    const obs = makeObs({ ts: monday3pmCT });
    const { grid, total } = buildHourOfWeek([], [obs]);
    expect(total).toBe(1);
    expect(grid[1][15]).toBe(1); // Monday, 3pm
  });

  it('does not double-count a merged alert+observation pair', () => {
    const alert = makeAlert({ first_seen_ts: NOW, resolved_ts: NOW + 60 * 60_000 });
    const obs = makeObs({ ts: NOW + 30 * 60_000, resolved_ts: NOW + 60 * 60_000 });
    const { total } = buildHourOfWeek([alert], [obs]);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildSignalsByLine
// ---------------------------------------------------------------------------
describe('buildSignalsByLine', () => {
  it('counts each signal kind per train line', () => {
    const obs = [
      makeObs({ id: 1, line: 'red', detection_source: 'gap' }),
      makeObs({ id: 2, line: 'red', detection_source: 'gap' }),
      makeObs({ id: 3, line: 'red', detection_source: 'roundup', signals: ['bunching', 'ghost'] }),
      makeObs({ id: 4, line: 'blue', detection_source: 'bunching' }),
    ];
    const { byLine, totals } = buildSignalsByLine(obs);
    expect(byLine.red).toMatchObject({ gap: 2, bunching: 1, ghost: 1 });
    expect(byLine.blue).toMatchObject({ bunching: 1 });
    expect(totals.gap).toBe(2);
    expect(totals.bunching).toBe(2);
    expect(totals.ghost).toBe(1);
  });

  it('ignores bus observations', () => {
    const obs = [
      makeObs({ id: 1, kind: 'bus', line: '66', detection_source: 'gap' }),
      makeObs({ id: 2, kind: 'train', line: 'red', detection_source: 'gap' }),
    ];
    expect(buildSignalsByLine(obs).totals.gap).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDailyTrend
// ---------------------------------------------------------------------------
describe('buildDailyTrend', () => {
  it('returns zeroed arrays of the right length for empty data', () => {
    const r = buildDailyTrend([], [], 30, NOW);
    expect(r.counts).toHaveLength(30);
    expect(r.avg).toHaveLength(30);
    expect(r.recent7Avg).toBe(0);
    expect(r.prior7Avg).toBe(0);
    expect(r.trendRatio).toBeNull();
  });

  it('places incidents into the right day bucket (today is last)', () => {
    const alerts = [
      makeAlert({ alert_id: 1, first_seen_ts: NOW }),
      makeAlert({ alert_id: 2, first_seen_ts: NOW - 5 * DAY }),
    ];
    const { counts } = buildDailyTrend(alerts, [], 10, NOW);
    expect(counts[counts.length - 1]).toBe(1); // today
    expect(counts[counts.length - 1 - 5]).toBe(1); // 5 days ago
  });

  it('flags an upward trend when recent 7 days outpace the prior 7', () => {
    const alerts = [];
    let id = 0;
    // Prior week: 1 incident/day. Recent week: 4 incidents/day.
    for (let d = 7; d < 14; d++) {
      alerts.push(makeAlert({ alert_id: ++id, first_seen_ts: NOW - d * DAY }));
    }
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 4; i++) {
        alerts.push(makeAlert({ alert_id: ++id, first_seen_ts: NOW - d * DAY - i * 60_000 }));
      }
    }
    const r = buildDailyTrend(alerts, [], 30, NOW);
    expect(r.recent7Avg).toBeCloseTo(4, 5);
    expect(r.prior7Avg).toBeCloseTo(1, 5);
    expect(r.trendRatio).toBeCloseTo(4, 5);
  });
});

// ---------------------------------------------------------------------------
// findRelatedIncidents
// ---------------------------------------------------------------------------
describe('findRelatedIncidents', () => {
  const baseAlert = makeAlert({
    alert_id: 'A1',
    routes: ['red'],
    first_seen_ts: NOW,
    post_url: 'https://bsky.app/profile/x/post/self',
  });

  it('returns incidents on the same line within the window', () => {
    const before = makeAlert({
      alert_id: 'A2',
      routes: ['red'],
      first_seen_ts: NOW - 6 * 60 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/before',
    });
    const after = makeObs({
      id: 99,
      line: 'red',
      ts: NOW + 12 * 60 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/after',
    });
    const r = findRelatedIncidents(baseAlert, [baseAlert, before], [after]);
    expect(r).toHaveLength(2);
    expect(r[0].post_url).toBe(after.post_url);
    expect(r[1].alert_id).toBe(before.alert_id);
  });

  it('excludes the incident itself by post_url', () => {
    const r = findRelatedIncidents(baseAlert, [baseAlert], []);
    expect(r).toHaveLength(0);
  });

  it('drops incidents on different lines', () => {
    const otherLine = makeAlert({
      alert_id: 'A3',
      routes: ['blue'],
      first_seen_ts: NOW - 60_000,
      post_url: 'https://bsky.app/profile/x/post/blue',
    });
    const r = findRelatedIncidents(baseAlert, [baseAlert, otherLine], []);
    expect(r).toHaveLength(0);
  });

  it('drops incidents outside the ±24h default window', () => {
    const old = makeAlert({
      alert_id: 'A4',
      routes: ['red'],
      first_seen_ts: NOW - 26 * 60 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/old',
    });
    const r = findRelatedIncidents(baseAlert, [baseAlert, old], []);
    expect(r).toHaveLength(0);
  });

  it('does not cross kinds (train alert vs bus obs same key)', () => {
    const busObs = makeObs({
      id: 1,
      kind: 'bus',
      line: 'red', // contrived — wouldn't normally collide, but verifies the kind guard
      ts: NOW - 60_000,
      post_url: 'https://bsky.app/profile/x/post/bus',
    });
    const r = findRelatedIncidents(baseAlert, [baseAlert], [busObs]);
    expect(r).toHaveLength(0);
  });
});
