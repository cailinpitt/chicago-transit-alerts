import { describe, expect, it } from 'vitest';
import {
  METRA_LINE_ORDER,
  METRA_LINES,
  metraLineInfo,
  normalizeMetraLine,
} from '../lib/metraLines.js';

describe('metraLines', () => {
  it('has all 11 lines with hex colors', () => {
    expect(METRA_LINE_ORDER).toHaveLength(11);
    for (const k of METRA_LINE_ORDER) {
      expect(METRA_LINES[k].label).toBeTruthy();
      expect(METRA_LINES[k].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
  it('normalizes raw route_ids (UP-W -> up-w) and resolves info either case', () => {
    expect(normalizeMetraLine('UP-W')).toBe('up-w');
    expect(metraLineInfo('UP-W').label).toBe('Union Pacific West');
    expect(metraLineInfo('bnsf').label).toBe('BNSF');
    expect(normalizeMetraLine(null)).toBe(null);
  });
});
