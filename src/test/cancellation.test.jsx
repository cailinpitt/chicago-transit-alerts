import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentList from '../components/IncidentList.jsx';
import MetraUpcomingCancellations from '../components/MetraUpcomingCancellations.jsx';
import {
  cancellationInfo,
  cancellationSchedulePhrase,
  cancellationStatusLabel,
  collectUpcomingCancellations,
} from '../lib/cancellation.js';

const NOW = 1_000_000_000_000;

// A Metra single-train cancellation incident. `cancellation` is the top-level
// block the cta-insights export ships; `state` flips upcoming → cancelled
// server-side.
const cancelInc = (cancellation, over = {}) => ({
  id: 'metra1',
  kind: 'metra',
  routes: ['UP-W'],
  first_seen_ts: NOW - 20 * 60_000,
  resolved_ts: cancellation.state === 'cancelled' ? NOW - 10 * 60_000 : null,
  active: cancellation.state !== 'cancelled',
  cancellation,
  cta: {
    alert_id: 'm-a1',
    headline: 'UPW train #67 will not operate',
    post_url: 'https://bsky.app/alert',
    first_seen_ts: NOW - 20 * 60_000,
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

describe('collectUpcomingCancellations', () => {
  const other = { id: 'x', kind: 'metra', routes: ['up-w'], cta: { headline: 'Signal problems' } };

  it('returns only upcoming cancellations whose departure is still ahead, soonest first', () => {
    const soon = cancelInc(
      { ...UPCOMING, scheduled_departure_ts: NOW + 30 * 60_000 },
      { id: 'soon' },
    );
    const later = cancelInc(
      { ...UPCOMING, scheduled_departure_ts: NOW + 90 * 60_000 },
      { id: 'later' },
    );
    const past = cancelInc(
      { ...UPCOMING, scheduled_departure_ts: NOW - 5 * 60_000 },
      { id: 'past' },
    );
    const done = cancelInc(CANCELLED, { id: 'done' });
    const got = collectUpcomingCancellations([later, done, soon, past, other], { now: NOW });
    expect(got.map((g) => g.id)).toEqual(['soon', 'later']); // past + cancelled + non-cancel dropped
    expect(got[0].trainNumber).toBe('67');
  });

  it('is empty when there are no upcoming cancellations', () => {
    expect(collectUpcomingCancellations([other, cancelInc(CANCELLED)], { now: NOW })).toEqual([]);
  });
});

describe('MetraUpcomingCancellations', () => {
  it('renders nothing when there are no upcoming cancellations', () => {
    const { container } = render(
      <MetraUpcomingCancellations incidents={[cancelInc(CANCELLED)]} now={NOW} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists upcoming cancellations with a count, train number, and origin', () => {
    render(<MetraUpcomingCancellations incidents={[cancelInc(UPCOMING)]} now={NOW} />);
    expect(screen.getByText(/1 upcoming cancellation/)).toBeInTheDocument();
    expect(screen.getByText('Train #67')).toBeInTheDocument();
    expect(screen.getByText(/Chicago OTC/)).toBeInTheDocument();
  });
});
