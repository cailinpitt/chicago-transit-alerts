import { describe, it, expect } from 'vitest';
import { parseUrlState, buildSearch } from '../lib/urlState.js';

describe('parseUrlState', () => {
  it('returns defaults when no params present', () => {
    expect(parseUrlState('')).toEqual({
      selectedLines: null,
      showBus: true,
      selectedBusRoutes: [],
      dateRange: 90,
    });
  });

  it('parses lines list', () => {
    expect(parseUrlState('?lines=red,blue').selectedLines).toEqual(['red', 'blue']);
  });

  it('parses lines=none as empty selection', () => {
    expect(parseUrlState('?lines=none').selectedLines).toEqual([]);
  });

  it('drops unknown line keys silently', () => {
    expect(parseUrlState('?lines=red,fake,blue').selectedLines).toEqual(['red', 'blue']);
  });

  it('falls back to default when every line key is invalid', () => {
    expect(parseUrlState('?lines=fake,bogus').selectedLines).toBeNull();
  });

  it('parses bus=0 as hidden', () => {
    expect(parseUrlState('?bus=0').showBus).toBe(false);
  });

  it('defaults showBus to false when narrowed to a positive train selection', () => {
    expect(parseUrlState('?lines=red').showBus).toBe(false);
  });

  it('defaults showBus to true when lines=none (bus-only view)', () => {
    expect(parseUrlState('?lines=none').showBus).toBe(true);
  });

  it('honors explicit bus=1 override even when lines is narrowed', () => {
    expect(parseUrlState('?lines=red&bus=1').showBus).toBe(true);
  });

  it('parses bus routes', () => {
    expect(parseUrlState('?routes=66,77').selectedBusRoutes).toEqual(['66', '77']);
  });

  it('drops non-numeric bus routes', () => {
    expect(parseUrlState('?routes=66,abc,77').selectedBusRoutes).toEqual(['66', '77']);
  });

  it('parses range=all as null', () => {
    expect(parseUrlState('?range=all').dateRange).toBeNull();
  });

  it('parses numeric range', () => {
    expect(parseUrlState('?range=30').dateRange).toBe(30);
  });

  it('falls back when range is unknown', () => {
    expect(parseUrlState('?range=42').dateRange).toBe(90);
  });
});

describe('buildSearch', () => {
  it('returns empty string for default state', () => {
    expect(buildSearch({
      selectedLines: null,
      showBus: true,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('');
  });

  it('serializes selected lines (and the implicit bus=0 stays implicit)', () => {
    expect(buildSearch({
      selectedLines: ['red', 'blue'],
      showBus: false,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('?lines=red%2Cblue');
  });

  it('serializes empty line selection as none', () => {
    expect(buildSearch({
      selectedLines: [],
      showBus: true,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('?lines=none');
  });

  it('serializes bus hidden against the all-trains default', () => {
    expect(buildSearch({
      selectedLines: null,
      showBus: false,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('?bus=0');
  });

  it('omits bus param when showBus matches the narrowed-train default (false)', () => {
    expect(buildSearch({
      selectedLines: ['red'],
      showBus: false,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('?lines=red');
  });

  it('emits bus=1 when user overrides the narrowed-train default', () => {
    expect(buildSearch({
      selectedLines: ['red'],
      showBus: true,
      selectedBusRoutes: [],
      dateRange: 90,
    })).toBe('?lines=red&bus=1');
  });

  it('serializes bus routes', () => {
    expect(buildSearch({
      selectedLines: null,
      showBus: true,
      selectedBusRoutes: ['66', '77'],
      dateRange: 90,
    })).toBe('?routes=66%2C77');
  });

  it('serializes non-default range', () => {
    expect(buildSearch({
      selectedLines: null,
      showBus: true,
      selectedBusRoutes: [],
      dateRange: 30,
    })).toBe('?range=30');
  });

  it('serializes range=all', () => {
    expect(buildSearch({
      selectedLines: null,
      showBus: true,
      selectedBusRoutes: [],
      dateRange: null,
    })).toBe('?range=all');
  });

  it('round-trips a complex state', () => {
    const state = {
      selectedLines: ['red'],
      showBus: false,
      selectedBusRoutes: ['66'],
      dateRange: 30,
    };
    expect(parseUrlState(buildSearch(state))).toEqual(state);
  });
});
