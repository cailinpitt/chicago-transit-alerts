import { describe, expect, it } from 'vitest';
import { gateIncidents } from '../lib/metraGate.js';

describe('gateIncidents', () => {
  const incidents = [
    { id: 'a', kind: 'train' },
    { id: 'b', kind: 'bus' },
    { id: 'c', kind: 'metra' },
    { id: 'd', kind: 'metra' },
  ];

  it('drops kind=metra by default (Metra disabled)', () => {
    const out = gateIncidents(incidents, false);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps everything when Metra is enabled', () => {
    expect(gateIncidents(incidents, true)).toHaveLength(4);
  });

  it('drops v2 commuter_rail incidents when Metra is disabled', () => {
    const out = gateIncidents(
      [
        { id: 'cta-train', agency: 'cta', mode: 'train' },
        { id: 'metra-rail', agency: 'metra', mode: 'commuter_rail' },
      ],
      false,
    );
    expect(out.map((i) => i.id)).toEqual(['cta-train']);
  });

  it('is null/undefined safe', () => {
    expect(gateIncidents(null, false)).toEqual([]);
    expect(gateIncidents(undefined, true)).toEqual([]);
  });
});
