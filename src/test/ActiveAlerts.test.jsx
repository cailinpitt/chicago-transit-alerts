import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ActiveAlerts from '../components/ActiveAlerts.jsx';
import { incident } from './v2TestHelpers.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

// Nested incident shape with a CTA block — ActiveCard shows `cta.headline`
// directly, so the headline doubles as a stable text handle in assertions.
const activeInc = (over = {}) =>
  incident({
    id: 'a1',
    kind: 'train',
    routes: ['red'],
    active: true,
    first_seen_ts: NOW - 20 * MIN,
    resolved_ts: null,
    cta: {
      alert_id: 'x',
      headline: 'Red Line Delays',
      post_url: 'https://bsky.app/profile/x/post/a1',
      first_seen_ts: NOW - 20 * MIN,
    },
    observations: [],
    ...over,
  });

describe('ActiveAlerts', () => {
  it('renders the "Active Now" heading with the combined active + long-running count', () => {
    render(
      <ActiveAlerts
        incidents={[activeInc({ id: 'a1' })]}
        longRunningIncidents={[activeInc({ id: 'lr1', first_seen_ts: NOW - 3 * 24 * 60 * MIN })]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    expect(screen.getByText(/Active Now/i)).toBeInTheDocument();
    // 1 active + 1 long-running.
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('keeps the first two incidents as full cards and collapses the rest to compact rows', () => {
    render(
      <ActiveAlerts
        incidents={[
          activeInc({
            id: 'a1',
            cta: { headline: 'First', post_url: 'https://bsky.app/profile/x/post/a1' },
          }),
          activeInc({
            id: 'a2',
            cta: { headline: 'Second', post_url: 'https://bsky.app/profile/x/post/a2' },
          }),
          activeInc({
            id: 'a3',
            cta: { headline: 'Third', post_url: 'https://bsky.app/profile/x/post/a3' },
          }),
        ]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    // All three are present somewhere in the section.
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
    // Only full cards carry a Share/Copy link, so exactly two appear.
    expect(screen.getAllByText(/share|copy link/i)).toHaveLength(2);
    // The collapsed row still links straight to the event permalink.
    expect(document.querySelector('a[href="/event/a3"]')).not.toBeNull();
  });

  it('shows the burst chip only when the recent rate clears the threshold', () => {
    const { rerender } = render(
      <ActiveAlerts
        incidents={[activeInc()]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
        burst={{ recentCount: 4, windowHours: 3, ratio: 2.5 }}
      />,
    );
    expect(screen.getByText(/4 in 3h · 2\.5× typical rate/)).toBeInTheDocument();

    // Below the ratio threshold (2×) → no chip.
    rerender(
      <ActiveAlerts
        incidents={[activeInc()]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
        burst={{ recentCount: 4, windowHours: 3, ratio: 1.2 }}
      />,
    );
    expect(screen.queryByText(/typical rate/)).not.toBeInTheDocument();
  });
});
