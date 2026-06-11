import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentList from '../components/IncidentList.jsx';
import {
  cancellationInfo,
  cancellationSchedulePhrase,
  cancellationStatusLabel,
} from '../lib/cancellation.js';

const NOW = 1_000_000_000_000;

// A Metra single-train cancellation incident. `cta.cancellation` is the block
// the cta-insights export ships; `state` flips upcoming → cancelled server-side.
const cancelInc = (cancellation, over = {}) => ({
  id: 'metra1',
  kind: 'metra',
  routes: ['UP-W'],
  first_seen_ts: NOW - 20 * 60_000,
  resolved_ts: cancellation.state === 'cancelled' ? NOW - 10 * 60_000 : null,
  active: cancellation.state !== 'cancelled',
  cta: {
    alert_id: 'm-a1',
    headline: 'UPW train #67 will not operate',
    post_url: 'https://bsky.app/alert',
    first_seen_ts: NOW - 20 * 60_000,
    cancellation,
  },
  observations: [],
  ...over,
});

const UPCOMING = {
  state: 'upcoming',
  scheduled_departure_ts: NOW + 60 * 60_000,
  scheduled_arrival_ts: NOW + 148 * 60_000,
  train_number: '67',
  origin: 'Chicago OTC',
};
const CANCELLED = { ...UPCOMING, state: 'cancelled' };

describe('cancellation helpers', () => {
  it('returns null for an incident with no cancellation block', () => {
    expect(cancellationInfo({ cta: { headline: 'x' } })).toBeNull();
    expect(cancellationInfo({ cta: null })).toBeNull();
    expect(cancellationInfo(undefined)).toBeNull();
  });

  it('normalizes the cancellation block', () => {
    const info = cancellationInfo(cancelInc(UPCOMING));
    expect(info.isUpcoming).toBe(true);
    expect(info.isCancelled).toBe(false);
    expect(info.trainNumber).toBe('67');
    expect(info.origin).toBe('Chicago OTC');
  });

  it('labels each state', () => {
    expect(cancellationStatusLabel(cancellationInfo(cancelInc(UPCOMING)))).toBe(
      'upcoming cancellation',
    );
    expect(cancellationStatusLabel(cancellationInfo(cancelInc(CANCELLED)))).toBe('cancelled');
    expect(cancellationStatusLabel(null)).toBeNull();
  });

  it('builds the schedule phrase (full run, departure-only, none)', () => {
    expect(cancellationSchedulePhrase(cancellationInfo(cancelInc(UPCOMING)))).toMatch(/→/);
    const depOnly = cancellationInfo(cancelInc({ ...UPCOMING, scheduled_arrival_ts: null }));
    expect(cancellationSchedulePhrase(depOnly)).toMatch(/departure$/);
    const noTimes = cancellationInfo(cancelInc({ ...UPCOMING, scheduled_departure_ts: null }));
    expect(cancellationSchedulePhrase(noTimes)).toBeNull();
  });
});

describe('IncidentList cancellation rendering', () => {
  it('shows an "upcoming cancellation" badge, not "ongoing", for an upcoming cancellation', () => {
    render(<IncidentList incidents={[cancelInc(UPCOMING)]} />);
    expect(screen.getByText('upcoming cancellation')).toBeInTheDocument();
    expect(screen.queryByText('ongoing')).not.toBeInTheDocument();
  });

  it('shows a "cancelled" badge, not "resolved" or a duration, for a finalized cancellation', () => {
    render(<IncidentList incidents={[cancelInc(CANCELLED)]} />);
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/duration/i)).not.toBeInTheDocument();
  });
});
