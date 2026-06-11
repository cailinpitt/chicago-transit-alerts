import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import IncidentList from '../components/IncidentList.jsx';

const NOW = 1_000_000_000_000;

// Nested incident wire shape: top-level id/kind/routes, a nullable `cta` block,
// and an `observations[]` list.
const obsRecord = (over = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'Jarvis',
  to_station: '95th/Dan Ryan',
  ts: NOW - 55 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/obs',
  ...over,
});

const alertInc = (over = {}) => ({
  id: 'alert1',
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW - 60 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  cta: {
    alert_id: 'a1',
    headline: 'Red Line Delays',
    post_url: 'https://bsky.app/alert',
    first_seen_ts: NOW - 60 * 60_000,
  },
  observations: [],
  ...over,
});

const obsInc = (over = {}) => ({
  id: 'obs1',
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW - 55 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  cta: null,
  observations: [obsRecord()],
  ...over,
});

const mergedInc = (over = {}) => ({
  ...alertInc(),
  id: 'm1',
  observations: [obsRecord()],
  ...over,
});

describe('IncidentList', () => {
  it('shows empty state when there are no incidents', () => {
    render(<IncidentList incidents={[]} />);
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });

  it('shows "via CTA" tag for CTA-only incidents', () => {
    render(<IncidentList incidents={[alertInc()]} />);
    expect(screen.getByText('via CTA')).toBeInTheDocument();
  });

  it('shows "via auto-detection" tag for bot-only incidents', () => {
    render(<IncidentList incidents={[obsInc()]} />);
    expect(screen.getByText('via auto-detection')).toBeInTheDocument();
  });

  it('shows both tags for a merged incident', () => {
    render(<IncidentList incidents={[mergedInc()]} />);
    expect(screen.getByText('via CTA')).toBeInTheDocument();
    expect(screen.getByText('via auto-detection')).toBeInTheDocument();
  });

  it('shows both Bluesky links for a merged incident', () => {
    render(<IncidentList incidents={[mergedInc()]} />);
    expect(screen.getByText('Via CTA →')).toBeInTheDocument();
    expect(screen.getByText('Bot detection →')).toBeInTheDocument();
  });

  it('shows the station segment for a merged incident', () => {
    render(<IncidentList incidents={[mergedInc()]} />);
    expect(screen.getByText('Jarvis')).toBeInTheDocument();
    expect(screen.getByText('95th/Dan Ryan')).toBeInTheDocument();
  });

  it('shows "ongoing" badge for active incidents', () => {
    render(<IncidentList incidents={[alertInc({ resolved_ts: null, active: true })]} />);
    expect(screen.getByText('ongoing')).toBeInTheDocument();
  });

  it('shows a "delayed" badge and leads with the train number for a Metra delay', () => {
    const delayInc = {
      id: 'metra-992',
      kind: 'metra',
      routes: ['bnsf'],
      first_seen_ts: NOW,
      resolved_ts: NOW,
      active: false,
      cta: null,
      observations: [
        {
          id: 'metra-992',
          kind: 'metra',
          line: 'bnsf',
          train_number: '121',
          from_station: 'Aurora',
          to_station: 'Chicago Union Station',
          detection_source: 'delay',
          ts: NOW,
          resolved_ts: NOW,
          active: false,
          bot_description: '~57 min late — the 12:05 PM Chicago Union Station train',
        },
      ],
    };
    render(<IncidentList incidents={[delayInc]} />);
    expect(screen.getByText('delayed')).toBeInTheDocument();
    expect(screen.getByText('BNSF train #121 delayed')).toBeInTheDocument();
    // The affected stretch moves to the secondary line.
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Chicago Union Station')).toBeInTheDocument();
  });

  it('shows a "possible cancellation" badge for an inferred Metra cancellation', () => {
    const inferredInc = {
      id: 'metra-972',
      kind: 'metra',
      routes: ['ri'],
      first_seen_ts: NOW,
      resolved_ts: NOW,
      active: false,
      cta: null,
      observations: [
        {
          id: 'metra-972',
          kind: 'metra',
          line: 'ri',
          from_station: 'LaSalle Street',
          to_station: 'Joliet',
          detection_source: 'cancellation-inferred',
          ts: NOW,
          resolved_ts: NOW,
          active: false,
          bot_description: 'Scheduled train not seen running — the 9:55 AM Joliet train',
        },
      ],
    };
    render(<IncidentList incidents={[inferredInc]} />);
    expect(screen.getByText('possible cancellation')).toBeInTheDocument();
    expect(
      screen.getByText('Scheduled train not seen running — the 9:55 AM Joliet train'),
    ).toBeInTheDocument();
    expect(screen.getByText('LaSalle Street')).toBeInTheDocument();
    expect(screen.getByText('Joliet')).toBeInTheDocument();
  });

  it('shows load more button when incidents exceed page size', () => {
    const incidents = Array.from({ length: 26 }, (_, i) =>
      alertInc({ id: `a${i + 1}`, first_seen_ts: NOW - (i + 1) * 60_000 }),
    );
    render(<IncidentList incidents={incidents} />);
    expect(screen.getByText(/load more/i)).toBeInTheDocument();
  });

  it('loads more incidents when load more is clicked', async () => {
    const incidents = Array.from({ length: 26 }, (_, i) =>
      alertInc({ id: `a${i + 1}`, first_seen_ts: NOW - (i + 1) * 60_000 }),
    );
    render(<IncidentList incidents={incidents} />);
    await userEvent.click(screen.getByText(/load more/i));
    expect(screen.queryByText(/load more/i)).not.toBeInTheDocument();
  });
});
