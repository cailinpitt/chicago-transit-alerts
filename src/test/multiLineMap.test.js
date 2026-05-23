import { describe, expect, it } from 'vitest';
import { affectedLineSegments } from '../lib/incidents.js';
import { buildMultiLineMap, sliceTrackBetween } from '../lib/lineMap.js';

describe('sliceTrackBetween', () => {
  // A simple horizontal polyline; stations sit on two of its points.
  const track = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];

  it('returns an SVG path between the two nearest points', () => {
    const d = sliceTrackBetween([track], { x: 10, y: 0 }, { x: 20, y: 0 });
    expect(typeof d).toBe('string');
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
  });

  it('picks the branch that best covers both endpoints', () => {
    const right = track;
    const wrong = [
      { x: 0, y: 100 },
      { x: 30, y: 100 },
    ];
    const d = sliceTrackBetween([wrong, right], { x: 10, y: 0 }, { x: 20, y: 0 });
    // The chosen path should hug y=0 (the right branch), not y=100.
    expect(d).not.toContain(',100');
  });

  it('returns null when no polyline has two usable points', () => {
    expect(sliceTrackBetween([[{ x: 0, y: 0 }]], { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('buildMultiLineMap', () => {
  it('returns null when no known line is given', () => {
    expect(buildMultiLineMap([])).toBeNull();
    expect(buildMultiLineMap(['not-a-line'])).toBeNull();
  });

  it('projects every requested line with its brand color', () => {
    const map = buildMultiLineMap(['purple', 'pink', 'green', 'brown', 'orange']);
    expect(map).not.toBeNull();
    expect(map.width).toBeGreaterThan(0);
    expect(map.height).toBeGreaterThan(0);
    const keys = map.tracksByLine.map((t) => t.key).sort();
    expect(keys).toEqual(['brown', 'green', 'orange', 'pink', 'purple']);
    for (const t of map.tracksByLine) {
      expect(t.color).toMatch(/^#/);
      expect(t.tracks.length).toBeGreaterThan(0);
    }
  });

  it('tags shared Loop stations with every serving line', () => {
    const map = buildMultiLineMap(['purple', 'pink', 'green', 'brown', 'orange']);
    const wabash = map.stations.find((s) => s.name === 'Washington/Wabash');
    expect(wabash).toBeTruthy();
    expect(wabash.lines.sort()).toEqual(['brown', 'green', 'orange', 'pink', 'purple']);
    expect(wabash.slug).toBe('washington-wabash');
  });

  it('dedups repeated line keys', () => {
    const map = buildMultiLineMap(['purple', 'purple', 'pink']);
    expect(map.tracksByLine.map((t) => t.key).sort()).toEqual(['pink', 'purple']);
  });
});

describe('affectedLineSegments', () => {
  it('returns one segment per merged observation, each on its own line', () => {
    const incident = {
      _type: 'merged',
      alert_id: '115102',
      routes: ['purple', 'pink', 'green', 'brown', 'orange'],
      obs_line: 'brown',
      from_station: 'Armitage (Brown/Purple)',
      to_station: 'Chicago (Brown/Purple)',
      affected_from_station: null,
      affected_to_station: null,
      extra_obs: [
        { line: 'pink', from_station: 'Ashland (Green/Pink)', to_station: 'Washington/Wabash' },
        { line: 'orange', from_station: '35th/Archer', to_station: 'Halsted (Orange)' },
      ],
    };
    const segs = affectedLineSegments(incident);
    expect(segs).toEqual([
      { line: 'brown', from: 'Armitage (Brown/Purple)', to: 'Chicago (Brown/Purple)' },
      { line: 'pink', from: 'Ashland (Green/Pink)', to: 'Washington/Wabash' },
      { line: 'orange', from: '35th/Archer', to: 'Halsted (Orange)' },
    ]);
  });

  it('uses the alert-level segment (line null) for a pure CTA alert', () => {
    const incident = {
      alert_id: 'a1',
      routes: ['red', 'purple'],
      affected_from_station: 'Belmont',
      affected_to_station: 'Howard',
    };
    expect(affectedLineSegments(incident)).toEqual([{ line: null, from: 'Belmont', to: 'Howard' }]);
  });

  it('returns the single segment for a standalone observation', () => {
    const incident = { line: 'red', from_station: 'Howard', to_station: 'Loyola' };
    expect(affectedLineSegments(incident)).toEqual([{ line: 'red', from: 'Howard', to: 'Loyola' }]);
  });

  it('skips segments with no endpoints', () => {
    const incident = { _type: 'merged', obs_line: 'red', extra_obs: [] };
    expect(affectedLineSegments(incident)).toEqual([]);
  });
});
