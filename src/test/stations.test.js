import { describe, expect, it } from 'vitest';
import { buildStationIndex, slugifyStation } from '../lib/stations.js';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const makeObs = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'Howard',
  to_station: 'Jarvis',
  ts: NOW - DAY,
  resolved_ts: NOW - DAY + 10 * 60_000,
  active: false,
  ...overrides,
});

const makeAlert = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  affected_from_station: 'Howard',
  affected_to_station: null,
  first_seen_ts: NOW - DAY,
  resolved_ts: NOW - DAY + 60_000,
  active: false,
  ...overrides,
});

describe('slugifyStation', () => {
  it('lowercases and dashifies', () => {
    expect(slugifyStation('Howard')).toBe('howard');
    expect(slugifyStation('Clark/Division')).toBe('clark-division');
    expect(slugifyStation("O'Hare")).toBe('o-hare');
  });

  it('handles parenthetical line qualifiers', () => {
    expect(slugifyStation('Central (Green)')).toBe('central-green');
    expect(slugifyStation('Western (Brown)')).toBe('western-brown');
  });

  it('returns null for empty/null input', () => {
    expect(slugifyStation(null)).toBeNull();
    expect(slugifyStation('')).toBeNull();
    expect(slugifyStation('---')).toBeNull();
  });
});

describe('buildStationIndex', () => {
  it('returns an empty map for empty input', () => {
    const r = buildStationIndex([], [], { now: NOW });
    expect(r.size).toBe(0);
  });

  it('indexes both endpoints of an observation', () => {
    const o = makeObs({ from_station: 'Howard', to_station: 'Jarvis' });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.has('howard')).toBe(true);
    expect(r.has('jarvis')).toBe(true);
  });

  it('accumulates lines a station appears on', () => {
    const obs = [
      makeObs({ id: 1, line: 'red' }),
      makeObs({ id: 2, line: 'p' }), // Howard is shared by Red + Purple
    ];
    const r = buildStationIndex([], obs, { now: NOW });
    expect(r.get('howard').lines.sort()).toEqual(['p', 'red']);
  });

  it('drops observations outside the rolling window', () => {
    const old = makeObs({ ts: NOW - 100 * DAY });
    const r = buildStationIndex([], [old], { now: NOW, windowDays: 90 });
    expect(r.size).toBe(0);
  });

  it('skips bus incidents', () => {
    const o = makeObs({ kind: 'bus', line: '66', from_station: 'Foo', to_station: 'Bar' });
    expect(buildStationIndex([], [o], { now: NOW }).size).toBe(0);
  });

  it('counts alerts and observations together at a station', () => {
    const o = makeObs({ from_station: 'Howard', to_station: null });
    const a = makeAlert({ affected_from_station: 'Howard' });
    const r = buildStationIndex([a], [o], { now: NOW });
    expect(r.get('howard').count).toBe(2);
  });

  it('does not double-count an observation that touches a station at both endpoints', () => {
    // Same name in both endpoints is contrived but the dedup guard is real.
    const o = makeObs({ from_station: 'Howard', to_station: 'Howard' });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.get('howard').count).toBe(1);
  });
});
