import { describe, expect, it } from 'vitest';
import {
  currentlyOut,
  outageDuration,
  outageHasLine,
  outagesForStation,
  stationHref,
  stationReliability,
} from '../lib/accessibility.js';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const outage = (over = {}) => ({
  id: 'cta-1',
  agency: 'cta',
  station: { slug: 'belmont-red-brown-purple', name: 'Belmont', lines: ['red', 'brn', 'p'] },
  unit_type: 'elevator',
  unit_label: 'to platform',
  lifecycle: {
    first_seen_ts: NOW - 2 * HOUR,
    last_seen_ts: NOW - HOUR,
    restored_ts: null,
    active: true,
  },
  ...over,
});

describe('accessibility helpers', () => {
  it('builds CTA and Metra station links', () => {
    expect(stationHref(outage())).toBe('/station/belmont-red-brown-purple');
    expect(
      stationHref(
        outage({ agency: 'metra', station: { slug: 'aurora', name: 'Aurora', lines: ['bnsf'] } }),
      ),
    ).toBe('/metra/station/aurora');
  });

  it('matches CTA line aliases when filtering outages', () => {
    const row = outage();
    expect(outageHasLine(row, 'brown')).toBe(true);
    expect(outageHasLine(row, 'brn')).toBe(true);
    expect(outageHasLine(row, 'blue')).toBe(false);
  });

  it('sorts active outages by current duration', () => {
    const rows = [
      outage({ id: 'cta-short', lifecycle: { ...outage().lifecycle, first_seen_ts: NOW - HOUR } }),
      outage({
        id: 'cta-long',
        lifecycle: { ...outage().lifecycle, first_seen_ts: NOW - 3 * HOUR },
      }),
    ];
    expect(currentlyOut(rows, { now: NOW }).map((o) => o.id)).toEqual(['cta-long', 'cta-short']);
    expect(outageDuration(rows[0], NOW)).toBe(HOUR);
  });

  it('finds station-specific rows and reliability totals', () => {
    const restored = outage({
      id: 'cta-restored',
      lifecycle: {
        first_seen_ts: NOW - 4 * HOUR,
        last_seen_ts: NOW - 3 * HOUR,
        restored_ts: NOW - 3 * HOUR,
        active: false,
      },
    });
    const rows = [outage(), restored];
    expect(
      outagesForStation(rows, { agency: 'cta', slug: 'belmont-red-brown-purple', now: NOW }),
    ).toHaveLength(2);
    const [station] = stationReliability(rows, { agency: 'cta', now: NOW });
    expect(station).toMatchObject({
      agency: 'cta',
      slug: 'belmont-red-brown-purple',
      outageCount: 2,
      currentlyOut: 1,
    });
  });
});
