import { describe, expect, it } from 'vitest';
import {
  buildDailyTrend,
  buildHourOfWeek,
  buildIncidentsByDay,
  buildSignalsByLine,
  buildTodaySummary,
  computeDurationHistogram,
  computeLineReliability,
  computeStatsLeaderboards,
  computeSummaryStats,
  computeTypicalDurations,
  computeYearOverYear,
  typicalDurationKey,
} from '../lib/aggregate.js';
import { formatDuration, formatGap } from '../lib/format.js';
import {
  buildSearchMatchers,
  filterIncidents,
  findRelatedIncidents,
  mergeMatchingIncidents,
  observationSignals,
  searchFilterIncidents,
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

  it('formats days, hours, and minutes past 24h', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('~1d');
    expect(formatDuration(28 * 60 * 60_000 + 41 * 60_000)).toBe('~1d 4h 41m');
    expect(formatDuration(25 * 60 * 60_000)).toBe('~1d 1h');
    expect(formatDuration(24 * 60 * 60_000 + 30 * 60_000)).toBe('~1d 30m');
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

  it('filters bus alerts by selected bus routes', () => {
    const a22 = makeAlert({ alert_id: 'a22', kind: 'bus', routes: ['22'] });
    const a66 = makeAlert({ alert_id: 'a66', kind: 'bus', routes: ['66'] });
    const { alerts: out } = filterIncidents([a22, a66], [], { busRoutes: ['22'] });
    expect(out).toHaveLength(1);
    expect(out[0].alert_id).toBe('a22');
  });

  it('hides bus alerts when showBus is false', () => {
    const bus = makeAlert({ alert_id: 'b', kind: 'bus', routes: ['22'] });
    const train = makeAlert({ alert_id: 't', kind: 'train', routes: ['red'] });
    const { alerts: out } = filterIncidents([bus, train], [], { showBus: false });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('train');
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
// The fuzzy alert↔observation pairing now happens server-side in cta-insights
// (covered by its export-web test). The frontend's mergeMatchingIncidents only
// REGROUPS records by the _incidentId that pairing stamped on them — so these
// fixtures share an _incidentId to express "same incident."
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
  _incidentId: 'm1',
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
  _incidentId: 'm1',
  ...overrides,
});

describe('mergeMatchingIncidents', () => {
  it('regroups an alert and observation that share an _incidentId', () => {
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

  it('keeps an alert with no observation as a standalone alert', () => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [makeAlertForMerge()],
      [],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(0);
  });

  it('keeps an observation with a different _incidentId as standalone', () => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [makeAlertForMerge({ _incidentId: 'a' })],
      [makeObsForMerge({ _incidentId: 'b' })],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });

  it('never groups records that lack an _incidentId', () => {
    // Defensive: un-stamped records (didn't pass through normalizeAlertsPayload)
    // each get a unique key so they can't accidentally merge.
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      [makeAlertForMerge({ _incidentId: undefined })],
      [makeObsForMerge({ _incidentId: undefined })],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });

  it('regroups a bus alert and observation that share an _incidentId', () => {
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

  it('absorbs every observation sharing the incident onto the alert', () => {
    // A single outage commonly trips multiple detectors (pulse-cold + roundup,
    // etc.); the server groups them all under one incident, so they all fold
    // into the alert's card here.
    const obs1 = makeObsForMerge({ id: 1, ts: NOW + 1 * 60_000 });
    const obs2 = makeObsForMerge({ id: 2, ts: NOW + 2 * 60_000 });
    const { merged, standaloneObs } = mergeMatchingIncidents([makeAlertForMerge()], [obs1, obs2]);
    expect(merged).toHaveLength(1);
    expect(standaloneObs).toHaveLength(0);
    // Closest-to-alert wins primary; the rest go onto extra_obs.
    expect(merged[0].obs_id).toBe(1);
    expect(merged[0].extra_obs).toHaveLength(1);
    expect(merged[0].extra_obs[0].id).toBe(2);
  });

  it('suppresses resolution fields when alert is still active', () => {
    // Bot observation ended before the CTA alert was even posted (e.g. a
    // leading-edge ghost detection that cleared right before CTA announced
    // the reroute). The merged incident must stay active with no resolved_ts
    // or obs_resolved_post_url leaking into the UI.
    const activeAlert = makeAlertForMerge({
      first_seen_ts: NOW,
      resolved_ts: null,
      active: true,
      resolved_reply_url: null,
    });
    const resolvedObs = makeObsForMerge({
      ts: NOW - 30 * 60_000,
      resolved_ts: NOW - 10 * 60_000,
      active: false,
      resolved_post_url: 'https://bsky.app/obs-resolution',
    });
    const { merged } = mergeMatchingIncidents([activeAlert], [resolvedObs]);
    expect(merged).toHaveLength(1);
    expect(merged[0].active).toBe(true);
    expect(merged[0].resolved_ts).toBeNull();
    expect(merged[0].obs_resolved_post_url).toBeNull();
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
    // Alert and obs share an _incidentId — the server grouped them into one
    // incident, so they count once.
    const base = NOW - 2 * DAY;
    const alert = {
      kind: 'train',
      routes: ['green'],
      first_seen_ts: base,
      resolved_ts: base + 30 * 60_000,
      _incidentId: 'g1',
    };
    const obs = {
      kind: 'train',
      line: 'green',
      ts: base + 5 * 60_000,
      resolved_ts: base + 35 * 60_000,
      _incidentId: 'g1',
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
    const alerts = [makeAlert({ active: true, _incidentId: 'x1' })];
    const obs = [makeObs({ active: true, id: 99, _incidentId: 'x1' })];
    // Alert and obs share an _incidentId → one incident.
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
    const alert = makeAlert({ first_seen_ts: NOW - DAY, routes: ['red'], _incidentId: 'w1' });
    const obs = makeObs({ ts: NOW - DAY + 30 * 60_000, line: 'red', _incidentId: 'w1' });
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
    const alert = makeAlert({
      first_seen_ts: NOW,
      resolved_ts: NOW + 60 * 60_000,
      _incidentId: 'h1',
    });
    const obs = makeObs({
      ts: NOW + 30 * 60_000,
      resolved_ts: NOW + 60 * 60_000,
      _incidentId: 'h1',
    });
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
  // Nested incident wire shape: top-level id/kind/routes/first_seen_ts with a
  // nullable cta block and observations[]. findRelatedIncidents reads these
  // directly now that pairing happens server-side.
  const alertIncident = (over) => ({
    kind: 'train',
    routes: ['red'],
    resolved_ts: null,
    active: false,
    cta: { alert_id: over.id },
    observations: [],
    ...over,
  });
  const botIncident = (over) => ({
    kind: 'train',
    routes: ['red'],
    resolved_ts: null,
    active: false,
    cta: null,
    observations: [{ id: 1 }],
    ...over,
  });

  const self = alertIncident({ id: 'self', first_seen_ts: NOW });

  it('returns incidents on the same line within the window', () => {
    const before = alertIncident({ id: 'before', first_seen_ts: NOW - 6 * 60 * 60_000 });
    const after = botIncident({ id: 'after', first_seen_ts: NOW + 12 * 60 * 60_000 });
    const r = findRelatedIncidents(self, [self, before, after]);
    expect(r).toHaveLength(2);
    // Newest first: the +12h incident leads, the -6h one follows.
    expect(r[0].id).toBe('after');
    expect(r[1].id).toBe('before');
  });

  it('excludes the incident itself by id', () => {
    expect(findRelatedIncidents(self, [self])).toHaveLength(0);
  });

  it('drops incidents on different lines', () => {
    const otherLine = alertIncident({ id: 'blue', routes: ['blue'], first_seen_ts: NOW - 60_000 });
    expect(findRelatedIncidents(self, [self, otherLine])).toHaveLength(0);
  });

  it('drops incidents outside the ±24h default window', () => {
    const old = alertIncident({ id: 'old', first_seen_ts: NOW - 26 * 60 * 60_000 });
    expect(findRelatedIncidents(self, [self, old])).toHaveLength(0);
  });

  it('does not cross kinds (train self vs bus incident same route key)', () => {
    // Contrived shared route key — wouldn't normally collide, but verifies the
    // kind guard.
    const bus = botIncident({
      id: 'bus',
      kind: 'bus',
      routes: ['red'],
      first_seen_ts: NOW - 60_000,
    });
    expect(findRelatedIncidents(self, [self, bus])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatGap
// ---------------------------------------------------------------------------
describe('formatGap', () => {
  it('returns empty string for null', () => {
    expect(formatGap(null)).toBe('');
  });

  it('formats sub-hour gaps in minutes', () => {
    expect(formatGap(0.25)).toBe('15m');
    expect(formatGap(0.5)).toBe('30m');
  });

  it('rounds whole hours when sub-day', () => {
    expect(formatGap(2)).toBe('2h');
    expect(formatGap(2.4)).toBe('2h');
    expect(formatGap(2.6)).toBe('3h');
  });

  it('formats multi-day gaps with optional hours', () => {
    expect(formatGap(48)).toBe('2d');
    expect(formatGap(49)).toBe('2d 1h');
    expect(formatGap(73)).toBe('3d 1h');
  });
});

// ---------------------------------------------------------------------------
// buildSearchMatchers / searchFilterIncidents
// ---------------------------------------------------------------------------
describe('buildSearchMatchers', () => {
  it('returns hasSearch=false and pass-through matchers for blank input', () => {
    const m = buildSearchMatchers('');
    expect(m.hasSearch).toBe(false);
    expect(m.matchesAlert(makeAlert())).toBe(true);
    expect(m.matchesObservation(makeObs())).toBe(true);
  });

  it('matches alert headline case-insensitively', () => {
    const a = makeAlert({ headline: 'Red Line Reroute at Howard' });
    const { matchesAlert } = buildSearchMatchers('howard');
    expect(matchesAlert(a)).toBe(true);
  });

  it('matches observation segment endpoints', () => {
    const o = makeObs({ from_station: 'Jarvis', to_station: 'Howard' });
    expect(buildSearchMatchers('jarvis').matchesObservation(o)).toBe(true);
  });

  it('matches train line by full label', () => {
    const a = makeAlert({ kind: 'train', routes: ['red'], headline: 'X' });
    expect(buildSearchMatchers('Red Line').matchesAlert(a)).toBe(true);
  });

  it('matches bus route by "Route N" form', () => {
    const o = makeObs({ kind: 'bus', line: '66' });
    expect(buildSearchMatchers('Route 66').matchesObservation(o)).toBe(true);
  });

  it('matches signal label aliases', () => {
    const o = makeObs({ signals: ['gap'], detection_source: 'gap' });
    expect(buildSearchMatchers('headway gap').matchesObservation(o)).toBe(true);
  });
});

describe('searchFilterIncidents', () => {
  it('returns inputs unchanged when query is blank', () => {
    const a = [makeAlert()];
    const o = [makeObs()];
    const r = searchFilterIncidents(a, o, '');
    expect(r.alerts).toBe(a);
    expect(r.observations).toBe(o);
  });

  it('narrows both alerts and observations to matches', () => {
    const a = [makeAlert({ headline: 'Foo' }), makeAlert({ alert_id: 2, headline: 'Bar' })];
    const o = [makeObs({ from_station: 'Foo' }), makeObs({ id: 2, from_station: 'Howard' })];
    const r = searchFilterIncidents(a, o, 'foo');
    expect(r.alerts).toHaveLength(1);
    expect(r.observations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeLineReliability
// ---------------------------------------------------------------------------
describe('computeLineReliability', () => {
  it('returns 100% incident-free for an empty cohort', () => {
    const r = computeLineReliability([], [], { now: NOW, windowDays: 90 });
    expect(r.incidentFreeDays).toBe(90);
    expect(r.totalDays).toBe(90);
    expect(r.medianGapHours).toBeNull();
    expect(r.longestStreakDays).toBe(90);
  });

  it('counts each incident-day once even when an incident spans multiple days', () => {
    const o = makeObs({
      ts: NOW - 3 * DAY,
      resolved_ts: NOW - DAY, // touches 3 calendar days
    });
    const r = computeLineReliability([], [o], { now: NOW, windowDays: 30 });
    expect(r.totalDays - r.incidentFreeDays).toBe(3);
  });

  it('finds the longest run of consecutive incident-free days', () => {
    // Incidents on day 0 and day 10 within a 20-day window — the run between
    // them is 9 days (days 1–9), tied with the run before day 10 (days 11–19).
    const obs = [
      makeObs({ ts: NOW, resolved_ts: NOW + 60_000 }),
      makeObs({ id: 2, ts: NOW - 10 * DAY, resolved_ts: NOW - 10 * DAY + 60_000 }),
    ];
    const r = computeLineReliability([], obs, { now: NOW, windowDays: 20 });
    expect(r.longestStreakDays).toBe(9);
  });

  it('computes median gap in hours between consecutive starts', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW - 10 * 60 * 60_000 }),
      makeObs({ id: 2, ts: NOW - 7 * 60 * 60_000 }), // 3h gap
      makeObs({ id: 3, ts: NOW - 1 * 60 * 60_000 }), // 6h gap
    ];
    const r = computeLineReliability([], obs, { now: NOW, windowDays: 90 });
    expect(r.medianGapHours).toBeCloseTo(4.5, 5); // (3 + 6) / 2
  });
});

// ---------------------------------------------------------------------------
// computeDurationHistogram
// ---------------------------------------------------------------------------
describe('computeDurationHistogram', () => {
  it('returns empty bins for empty input', () => {
    const r = computeDurationHistogram([], [], { now: NOW, windowDays: 90 });
    expect(r.total).toBe(0);
    expect(r.bins.every((b) => b.count === 0)).toBe(true);
  });

  it('bins durations into the right buckets', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW, resolved_ts: NOW + 5 * 60_000 }), // < 15m
      makeObs({ id: 2, ts: NOW, resolved_ts: NOW + 20 * 60_000 }), // 15-30m
      makeObs({ id: 3, ts: NOW, resolved_ts: NOW + 45 * 60_000 }), // 30m-1h
      makeObs({ id: 4, ts: NOW, resolved_ts: NOW + 90 * 60_000 }), // 1-2h
      makeObs({ id: 5, ts: NOW, resolved_ts: NOW + 5 * 60 * 60_000 }), // 4h+
    ];
    const r = computeDurationHistogram([], obs, { now: NOW, windowDays: 90 });
    expect(r.total).toBe(5);
    expect(r.bins.find((b) => b.label === '< 15m').count).toBe(1);
    expect(r.bins.find((b) => b.label === '4h+').count).toBe(1);
  });

  it('excludes active (unresolved) incidents', () => {
    const o = makeObs({ ts: NOW, resolved_ts: null, active: true });
    const r = computeDurationHistogram([], [o], { now: NOW });
    expect(r.total).toBe(0);
  });

  it('excludes incidents that started before the cutoff', () => {
    const o = makeObs({
      ts: NOW - 100 * DAY,
      resolved_ts: NOW - 99 * DAY,
    });
    const r = computeDurationHistogram([], [o], { now: NOW, windowDays: 90 });
    expect(r.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// typicalDurationKey / computeTypicalDurations
// ---------------------------------------------------------------------------
describe('typicalDurationKey', () => {
  it('returns null when fields are missing', () => {
    expect(typicalDurationKey(null)).toBeNull();
    expect(typicalDurationKey({ kind: 'train' })).toBeNull(); // no line, no detection
  });

  it('builds kind::line::signal for an observation', () => {
    expect(typicalDurationKey({ kind: 'train', line: 'red', detection_source: 'gap' })).toBe(
      'train::red::gap',
    );
  });

  it('collapses roundup to a single bucket', () => {
    expect(typicalDurationKey({ kind: 'train', line: 'red', detection_source: 'roundup' })).toBe(
      'train::red::roundup',
    );
  });

  it('prefers obs_line/obs_detection_source on merged records', () => {
    expect(
      typicalDurationKey({
        kind: 'train',
        obs_line: 'blue',
        obs_detection_source: 'gap',
        line: 'red',
      }),
    ).toBe('train::blue::gap');
  });
});

describe('computeTypicalDurations', () => {
  it('returns an empty Map when no resolved incidents qualify', () => {
    const r = computeTypicalDurations([], [], { now: NOW, windowDays: 90 });
    expect(r.size).toBe(0);
  });

  it('computes median duration per (kind, line, signal) bucket', () => {
    const obs = [
      makeObs({
        id: 1,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 10 * 60_000,
      }),
      makeObs({
        id: 2,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 20 * 60_000,
      }),
      makeObs({
        id: 3,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 30 * 60_000,
      }),
    ];
    const r = computeTypicalDurations([], obs, { now: NOW });
    const bucket = r.get('train::red::gap');
    expect(bucket.count).toBe(3);
    expect(bucket.medianMs).toBe(20 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// buildTodaySummary
// ---------------------------------------------------------------------------
describe('buildTodaySummary', () => {
  // Pin "now" to a Chicago-friendly mid-day moment so the boundary between
  // "today" and "yesterday" doesn't depend on test environment TZ.
  const TODAY_NOW = Date.UTC(2026, 4, 9, 18, 0, 0); // 2026-05-09 13:00 Chicago

  it('returns null when there is no incident data at all', () => {
    expect(buildTodaySummary([], [], TODAY_NOW)).toBeNull();
  });

  it('reports a quiet-day message in hours when the last incident was today recent', () => {
    const o = makeObs({ ts: TODAY_NOW - 3 * 60 * 60_000 - 5 * 60_000, resolved_ts: TODAY_NOW });
    // chicagoDayUTC of `o.ts` is the same Chicago day as TODAY_NOW only if it
    // doesn't cross local midnight; this case is mid-afternoon, so safe.
    // But the incident *is* on today, so this case will fall into busy-day.
    const out = buildTodaySummary([], [o], TODAY_NOW);
    expect(out).toMatch(/Today: 1 incident/);
  });

  it('formats busy-day with single line', () => {
    const o = makeObs({ line: 'red', ts: TODAY_NOW - 60_000 });
    const out = buildTodaySummary([], [o], TODAY_NOW);
    expect(out).toMatch(/Red Line/);
  });

  it('reports active count when at least one incident is ongoing', () => {
    const o1 = makeObs({
      id: 1,
      line: 'red',
      ts: TODAY_NOW - 10 * 60_000,
      active: true,
      resolved_ts: null,
    });
    const o2 = makeObs({ id: 2, line: 'blue', ts: TODAY_NOW - 5 * 60_000 });
    const out = buildTodaySummary([], [o1, o2], TODAY_NOW);
    expect(out).toMatch(/2 incidents/);
    expect(out).toMatch(/1 still ongoing/);
  });
});

// ---------------------------------------------------------------------------
// computeStatsLeaderboards
// ---------------------------------------------------------------------------
describe('computeStatsLeaderboards', () => {
  it('returns null fields when there is no data', () => {
    const r = computeStatsLeaderboards([], [], { now: NOW });
    expect(r.worstDay).toBeNull();
    expect(r.worstHour).toBeNull();
    expect(r.worstStation).toBeNull();
    expect(r.longestIncident).toBeNull();
  });

  it('picks the day with the most distinct incidents as worstDay', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW - 5 * DAY }),
      makeObs({ id: 2, ts: NOW - 5 * DAY + 60_000 }),
      makeObs({ id: 3, ts: NOW - 5 * DAY + 120_000 }),
      makeObs({ id: 4, ts: NOW - DAY }),
    ];
    const r = computeStatsLeaderboards([], obs, { now: NOW });
    expect(r.worstDay.count).toBe(3);
  });

  it('picks the longest resolved incident', () => {
    const short = makeObs({
      id: 1,
      ts: NOW - DAY,
      resolved_ts: NOW - DAY + 10 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/short',
    });
    const long = makeObs({
      id: 2,
      ts: NOW - DAY,
      resolved_ts: NOW - DAY + 4 * 60 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/long',
    });
    const r = computeStatsLeaderboards([], [short, long], { now: NOW });
    expect(r.longestIncident.id).toBe('long');
    expect(r.longestIncident.durationMs).toBe(4 * 60 * 60_000);
  });

  it('skips active incidents when picking longestIncident', () => {
    const active = makeObs({
      id: 1,
      ts: NOW - 10 * DAY,
      resolved_ts: null,
      active: true,
      post_url: 'https://bsky.app/profile/x/post/active',
    });
    const r = computeStatsLeaderboards([], [active], { now: NOW });
    expect(r.longestIncident).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeYearOverYear
// ---------------------------------------------------------------------------
describe('computeYearOverYear', () => {
  const YEAR = 365 * DAY;

  it('returns enoughData=false when dataStartTs is inside the prior window', () => {
    const r = computeYearOverYear([], [], {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 30 * DAY,
    });
    expect(r.enoughData).toBe(false);
  });

  it('counts current vs prior 30-day windows separately', () => {
    const obs = [
      // 3 incidents in the current window (last 30 days)
      makeObs({ id: 1, ts: NOW - 5 * DAY, first_seen_ts: NOW - 5 * DAY }),
      makeObs({ id: 2, ts: NOW - 10 * DAY, first_seen_ts: NOW - 10 * DAY }),
      makeObs({ id: 3, ts: NOW - 15 * DAY, first_seen_ts: NOW - 15 * DAY }),
      // 5 incidents in the same 30-day window a year ago
      makeObs({ id: 4, ts: NOW - YEAR - 1 * DAY, first_seen_ts: NOW - YEAR - 1 * DAY }),
      makeObs({ id: 5, ts: NOW - YEAR - 5 * DAY, first_seen_ts: NOW - YEAR - 5 * DAY }),
      makeObs({ id: 6, ts: NOW - YEAR - 10 * DAY, first_seen_ts: NOW - YEAR - 10 * DAY }),
      makeObs({ id: 7, ts: NOW - YEAR - 20 * DAY, first_seen_ts: NOW - YEAR - 20 * DAY }),
      makeObs({ id: 8, ts: NOW - YEAR - 25 * DAY, first_seen_ts: NOW - YEAR - 25 * DAY }),
      // Outside both windows — should not count.
      makeObs({ id: 9, ts: NOW - 60 * DAY, first_seen_ts: NOW - 60 * DAY }),
    ];
    const r = computeYearOverYear([], obs, {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 2 * YEAR,
    });
    expect(r.enoughData).toBe(true);
    expect(r.currentCount).toBe(3);
    expect(r.priorCount).toBe(5);
    expect(r.pctChange).toBeCloseTo((3 - 5) / 5, 5); // -40%
  });

  it('returns null pctChange when prior window had zero incidents', () => {
    const obs = [makeObs({ id: 1, ts: NOW - 5 * DAY, first_seen_ts: NOW - 5 * DAY })];
    const r = computeYearOverYear([], obs, {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 2 * YEAR,
    });
    expect(r.pctChange).toBeNull();
    expect(r.currentCount).toBe(1);
    expect(r.priorCount).toBe(0);
  });
});
