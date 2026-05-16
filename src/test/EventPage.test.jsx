import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventPage from '../components/EventPage.jsx';

const NOW = 1_000_000_000_000;

const PAYLOAD = {
  generated_at: NOW,
  data_start_ts: NOW - 90 * 24 * 60 * 60_000,
  alerts: [
    {
      alert_id: 'a1',
      kind: 'train',
      routes: ['red'],
      headline: 'Red Line Delays at Howard',
      first_seen_ts: NOW - 60 * 60_000,
      resolved_ts: NOW - 30 * 60_000,
      active: false,
      post_url: 'https://bsky.app/profile/did:plc:abc/post/abc123',
    },
    {
      alert_id: 'a3',
      kind: 'train',
      routes: ['brn'],
      headline: 'Brown Line Delays',
      short_description:
        'Brown Line service is experiencing delays due to a raised bridge at the Chicago River, downtown. Trains stopped near Chicago.',
      mentioned_stations: ['Chicago (Brown)'],
      first_seen_ts: NOW - 45 * 60_000,
      resolved_ts: NOW - 15 * 60_000,
      active: false,
      post_url: 'https://bsky.app/profile/did:plc:abc/post/brnriver',
    },
    {
      alert_id: 'a2',
      kind: 'bus',
      routes: ['2', '6'],
      headline: 'Temporary Reroute',
      short_description: 'SB State will be closed between Wacker and Randolph.',
      affected_from_station: 'Wacker',
      affected_to_station: 'Randolph',
      first_seen_ts: NOW - 30 * 60_000,
      resolved_ts: NOW - 5 * 60_000,
      active: false,
      post_url: 'https://bsky.app/profile/did:plc:abc/post/busreroute',
    },
  ],
  observations: [
    {
      id: 99,
      kind: 'bus',
      line: '66',
      ts: NOW - 10 * 60_000,
      resolved_ts: null,
      active: true,
      post_url: 'https://bsky.app/profile/did:plc:xyz/post/bus99',
    },
  ],
};

beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) }),
  );
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EventPage', () => {
  it('renders the matching alert by event id', async () => {
    render(<EventPage eventId="abc123" />);
    await waitFor(() => {
      expect(screen.getByText('Red Line Delays at Howard')).toBeInTheDocument();
    });
    expect(screen.getByText('View on Bluesky →')).toBeInTheDocument();
    expect(screen.getByText(/back to all incidents/i)).toBeInTheDocument();
  });

  it('renders a standalone observation by id', async () => {
    render(<EventPage eventId="bus99" />);
    await waitFor(() => {
      expect(screen.getByText('#66 Chicago')).toBeInTheDocument();
    });
    expect(screen.getByText('ongoing')).toBeInTheDocument();
  });

  it('shows a not-found message for an unknown id', async () => {
    render(<EventPage eventId="missing" />);
    await waitFor(() => {
      expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    });
  });

  it('does not link a station name when it is followed by a geographic suffix', async () => {
    // "Chicago River" / "Chicago Avenue" etc. should not be linked to the
    // Chicago station even when Chicago is in mentioned_stations. A bare
    // "Chicago" elsewhere in the same text should still link.
    render(<EventPage eventId="brnriver" />);
    await waitFor(() => {
      expect(screen.getByText(/raised bridge/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /^Chicago River$/ })).toBeNull();
    // The bare "Chicago" later in the sentence still links.
    expect(screen.getAllByRole('link', { name: 'Chicago' }).length).toBeGreaterThan(0);
  });

  it('does not render a station chips row for bus alerts', async () => {
    // affected_from_station / affected_to_station on bus alerts hold
    // cross-street labels, not rail stations — linking them produces
    // /station/wacker pages with no incidents. The chips are suppressed
    // for kind=bus so the broken links never appear.
    render(<EventPage eventId="busreroute" />);
    await waitFor(() => {
      expect(screen.getByText('Temporary Reroute')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stations')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Wacker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Randolph' })).not.toBeInTheDocument();
  });
});
