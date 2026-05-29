import { describe, expect, it } from 'vitest';
import {
  computeBotLead,
  computeCtaEstimate,
  computeCtaPlanned,
  formatLeadTime,
} from '../components/event/callouts.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

describe('formatLeadTime', () => {
  it('formats sub-hour spans as minutes', () => {
    expect(formatLeadTime(5 * MIN)).toBe('5 min');
    expect(formatLeadTime(59 * MIN)).toBe('59 min');
  });

  it('formats whole and partial hours', () => {
    expect(formatLeadTime(2 * HOUR)).toBe('2h');
    expect(formatLeadTime(90 * MIN)).toBe('1h 30m');
  });
});

describe('computeBotLead', () => {
  it('reports how far the earliest observation predates the CTA post', () => {
    const out = computeBotLead({
      isMerged: true,
      ctaFirstSeenTs: NOW,
      observations: [{ ts: NOW - 5 * MIN }, { onset_ts: NOW - 20 * MIN, ts: NOW - 10 * MIN }],
    });
    expect(out).toEqual({ phrase: '20 min', onsetTs: NOW - 20 * MIN });
  });

  it('returns null under the 2-minute threshold', () => {
    expect(
      computeBotLead({
        isMerged: true,
        ctaFirstSeenTs: NOW,
        observations: [{ ts: NOW - 1 * MIN }],
      }),
    ).toBeNull();
  });

  it('returns null for non-merged incidents or missing CTA time', () => {
    expect(computeBotLead({ isMerged: false, ctaFirstSeenTs: NOW, observations: [] })).toBeNull();
    expect(
      computeBotLead({ isMerged: true, ctaFirstSeenTs: null, observations: [{ ts: NOW }] }),
    ).toBeNull();
  });
});

describe('computeCtaPlanned', () => {
  it('returns null when CTA fired within 10 minutes (effectively live)', () => {
    expect(computeCtaPlanned({ ctaStartTs: NOW - 5 * MIN, startTs: NOW })).toBeNull();
  });

  it('formats a minutes-ahead gap', () => {
    expect(computeCtaPlanned({ ctaStartTs: NOW - 45 * MIN, startTs: NOW })).toBe('45 min ahead');
  });

  it('formats an hours-ahead gap', () => {
    expect(computeCtaPlanned({ ctaStartTs: NOW - (2 * HOUR + 30 * MIN), startTs: NOW })).toBe(
      '2h 30m ahead',
    );
  });

  it('formats a days-ahead gap', () => {
    expect(computeCtaPlanned({ ctaStartTs: NOW - (3 * DAY + 2 * HOUR), startTs: NOW })).toBe(
      '3d 2h ahead',
    );
  });

  it('returns null for a stale EventStart beyond 14 days', () => {
    expect(computeCtaPlanned({ ctaStartTs: NOW - 20 * DAY, startTs: NOW })).toBeNull();
  });
});

describe('computeCtaEstimate', () => {
  it('flags resolving after the stated end as "late"', () => {
    expect(
      computeCtaEstimate({ ctaEndTs: NOW, resolvedTs: NOW + 20 * MIN, dateOnly: false }),
    ).toEqual({ sameMinute: false, phrase: '20 min late' });
  });

  it('flags resolving before the stated end as "early", with hour formatting', () => {
    expect(
      computeCtaEstimate({
        ctaEndTs: NOW,
        resolvedTs: NOW - (1 * HOUR + 5 * MIN),
        dateOnly: false,
      }),
    ).toEqual({ sameMinute: false, phrase: '1h 5m early' });
  });

  it('reports "right on schedule" within the same minute', () => {
    expect(computeCtaEstimate({ ctaEndTs: NOW, resolvedTs: NOW, dateOnly: false })).toEqual({
      sameMinute: true,
      phrase: 'cleared right on schedule',
    });
  });

  it('skips date-only EventEnd and gaps beyond a week', () => {
    expect(
      computeCtaEstimate({ ctaEndTs: NOW, resolvedTs: NOW + 20 * MIN, dateOnly: true }),
    ).toBeNull();
    expect(
      computeCtaEstimate({ ctaEndTs: NOW, resolvedTs: NOW + 8 * DAY, dateOnly: false }),
    ).toBeNull();
  });
});
