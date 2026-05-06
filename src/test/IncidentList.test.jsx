import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncidentList from '../components/IncidentList.jsx';

const NOW = 1_000_000_000_000;

const makeAlert = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  headline: 'Red Line Delays',
  first_seen_ts: NOW - 60 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/alert',
  ...overrides,
});

const makeObs = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'Jarvis',
  to_station: '95th/Dan Ryan',
  ts: NOW - 55 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/obs',
  ...overrides,
});

describe('IncidentList', () => {
  it('shows empty state when there are no incidents', () => {
    render(<IncidentList alerts={[]} observations={[]} />);
    expect(screen.getByText(/no incidents/i)).toBeInTheDocument();
  });

  it('shows "via CTA" tag for standalone alerts', () => {
    render(<IncidentList alerts={[makeAlert()]} observations={[]} />);
    expect(screen.getByText('via CTA')).toBeInTheDocument();
  });

  it('shows "via auto-detection" tag for standalone observations', () => {
    render(<IncidentList alerts={[]} observations={[makeObs()]} />);
    expect(screen.getByText('via auto-detection')).toBeInTheDocument();
  });

  it('shows both tags for a merged alert+observation', () => {
    render(<IncidentList alerts={[makeAlert()]} observations={[makeObs()]} />);
    expect(screen.getByText('via CTA')).toBeInTheDocument();
    expect(screen.getByText('via auto-detection')).toBeInTheDocument();
  });

  it('shows both Bluesky links for a merged item', () => {
    render(<IncidentList alerts={[makeAlert()]} observations={[makeObs()]} />);
    expect(screen.getByText('Via CTA →')).toBeInTheDocument();
    expect(screen.getByText('Bot detection →')).toBeInTheDocument();
  });

  it('shows the station segment for a merged item', () => {
    render(<IncidentList alerts={[makeAlert()]} observations={[makeObs()]} />);
    expect(screen.getByText('Jarvis → 95th/Dan Ryan')).toBeInTheDocument();
  });

  it('shows "ongoing" badge for active incidents', () => {
    render(<IncidentList alerts={[makeAlert({ resolved_ts: null, active: true })]} observations={[]} />);
    expect(screen.getByText('ongoing')).toBeInTheDocument();
  });

  it('shows load more button when incidents exceed page size', async () => {
    const alerts = Array.from({ length: 26 }, (_, i) =>
      makeAlert({ alert_id: i + 1, first_seen_ts: NOW - (i + 1) * 60_000 }),
    );
    render(<IncidentList alerts={alerts} observations={[]} />);
    expect(screen.getByText(/load more/i)).toBeInTheDocument();
  });

  it('loads more incidents when load more is clicked', async () => {
    const alerts = Array.from({ length: 26 }, (_, i) =>
      makeAlert({ alert_id: i + 1, first_seen_ts: NOW - (i + 1) * 60_000 }),
    );
    render(<IncidentList alerts={alerts} observations={[]} />);
    await userEvent.click(screen.getByText(/load more/i));
    expect(screen.queryByText(/load more/i)).not.toBeInTheDocument();
  });
});
