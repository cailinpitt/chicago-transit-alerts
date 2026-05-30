import { describe, expect, it } from 'vitest';
import {
  computeHourOfDayContext,
  computeLineDurationRank,
  computeStretchRecurrence,
} from '../lib/aggregate.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed Chicago-afternoon anchor so hour bucketing is deterministic.
const NOW = Date.UTC(2026, 4, 28, 20, 0, 0); // 2026-05-28 20:00 UTC ≈ 15:00 CDT

function obs(line, from, to, source = 'pulse-cold') {
  return { line, from_station: from, to_station: to, detection_source: source };
}

describe('computeStretchRecurrence', () => {
  const incidents = [
    {
      id: 's1',
      kind: 'train',
      first_seen_ts: NOW - 1 * DAY,
      observations: [obs('orange', 'Western (Orange)', 'Ashland (Orange)')],
    },
    {
      id: 's2',
      kind: 'train',
      first_seen_ts: NOW - 10 * DAY,
      observations: [obs('orange', 'Western (Orange)', 'Ashland (Orange)')],
    },
    {
      id: 'self',
      kind: 'train',
      first_seen_ts: NOW,
      observations: [obs('orange', 'Western (Orange)', 'Ashland (Orange)')],
    },
    // Different stretch — must not count.
    {
      id: 'other',
      kind: 'train',
      first_seen_ts: NOW - 2 * DAY,
      observations: [obs('orange', 'Halsted', 'Ashland (Orange)')],
    },
  ];

  it('counts incidents on the same stretch and excludes self from priorCount', () => {
    const out = computeStretchRecurrence(incidents, {
      line: 'orange',
      fromStation: 'Western (Orange)',
      toStation: 'Ashland (Orange)',
      selfId: 'self',
      now: NOW,
      windowDays: 90,
    });
    expect(out.count).toBe(3); // includes self
    expect(out.priorCount).toBe(2); // excludes self
    expect(out.lastOtherTs).toBe(NOW - 1 * DAY);
  });

  it('returns null for a one-off stretch (no prior recurrence)', () => {
    expect(
      computeStretchRecurrence(incidents, {
        line: 'orange',
        fromStation: 'Halsted',
        toStation: 'Ashland (Orange)',
        selfId: 'other',
        now: NOW,
        windowDays: 90,
      }),
    ).toBeNull();
  });

  it('ignores roundup observations and missing stretch', () => {
    const round = [
      {
        id: 'r',
        kind: 'train',
        first_seen_ts: NOW,
        observations: [obs('orange', 'A', 'B', 'roundup')],
      },
    ];
    expect(
      computeStretchRecurrence(round, {
        line: 'orange',
        fromStation: 'A',
        toStation: 'B',
        now: NOW,
      }),
    ).toBeNull();
    expect(computeStretchRecurrence(incidents, { line: 'orange', now: NOW })).toBeNull();
  });
});

describe('computeLineDurationRank', () => {
  // 10 blue incidents; the subject is the longest.
  const incidents = [];
  for (let i = 0; i < 9; i++) {
    incidents.push({
      id: `b${i}`,
      kind: 'train',
      routes: ['blue'],
      first_seen_ts: NOW - (i + 1) * DAY,
      resolved_ts: NOW - (i + 1) * DAY + 20 * MIN,
    });
  }
  const subject = {
    id: 'subj',
    kind: 'train',
    routes: ['blue'],
    first_seen_ts: NOW - 5 * MIN,
    resolved_ts: NOW + 3 * HOUR,
  };
  incidents.push(subject);

  it('flags the longest incident on the line', () => {
    const out = computeLineDurationRank(subject, incidents, { now: NOW, windowDays: 30 });
    expect(out.tier).toBe('longest');
    expect(out.rank).toBe(1);
    expect(out.count).toBe(10);
  });

  it('returns null when the cohort is too small', () => {
    const tiny = [subject, incidents[0], incidents[1]];
    expect(computeLineDurationRank(subject, tiny, { now: NOW })).toBeNull();
  });

  it('returns null for an active (unbounded) incident', () => {
    const active = { ...subject, resolved_ts: null };
    expect(computeLineDurationRank(active, incidents, { now: NOW })).toBeNull();
  });
});

describe('computeHourOfDayContext', () => {
  // Pile 30 incidents into the same Chicago hour as NOW (15:00 CDT) so that
  // hour is far above the flat mean.
  const incidents = [];
  for (let i = 0; i < 30; i++) {
    incidents.push({ id: `h${i}`, kind: 'train', routes: ['red'], first_seen_ts: NOW - i * DAY });
  }
  const subject = { id: 'subj', kind: 'train', routes: ['red'], first_seen_ts: NOW };
  incidents.push(subject);

  it('flags a busy hour for the line', () => {
    const out = computeHourOfDayContext(subject, incidents, { now: NOW, windowDays: 90 });
    expect(out.tier).toBe('busy');
    expect(out.ratio).toBeGreaterThan(1.75);
  });

  it('returns null under the minimum sample', () => {
    const sparse = [subject, incidents[0], incidents[1]];
    expect(computeHourOfDayContext(subject, sparse, { now: NOW })).toBeNull();
  });
});
