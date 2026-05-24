import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventPage from '../components/EventPage.jsx';

const NOW = 1_000_000_000_000;

// Build the published incident wire shape: a top-level incident with a nullable
// `cta` block and an `observations[]` list. Train line keys are already full
// names ('purple') — normalization now happens server-side.
function ctaBlock(over) {
  return {
    alert_id: 'a',
    headline: '',
    short_description: null,
    mentioned_stations: [],
    affected_from_station: null,
    affected_to_station: null,
    affected_direction: null,
    resolved_reply_url: null,
    cta_event_start_ts: null,
    cta_event_end_ts: null,
    cta_event_start_is_date_only: false,
    cta_event_end_is_date_only: false,
    ...over,
  };
}

const PAYLOAD = {
  generated_at: NOW,
  data_start_ts: NOW - 90 * 24 * 60 * 60_000,
  incidents: [
    {
      id: 'abc123',
      kind: 'train',
      routes: ['red'],
      first_seen_ts: NOW - 60 * 60_000,
      resolved_ts: NOW - 30 * 60_000,
      active: false,
      sources: ['cta'],
      cta: ctaBlock({
        alert_id: 'a1',
        headline: 'Red Line Delays at Howard',
        first_seen_ts: NOW - 60 * 60_000,
        resolved_ts: NOW - 30 * 60_000,
        active: false,
        post_url: 'https://bsky.app/profile/did:plc:abc/post/abc123',
      }),
      observations: [],
    },
    {
      id: 'brnriver',
      kind: 'train',
      routes: ['brown'],
      first_seen_ts: NOW - 45 * 60_000,
      resolved_ts: NOW - 15 * 60_000,
      active: false,
      sources: ['cta'],
      cta: ctaBlock({
        alert_id: 'a3',
        headline: 'Brown Line Delays',
        short_description:
          'Brown Line service is experiencing delays due to a raised bridge at the Chicago River, downtown. Trains stopped near Chicago.',
        mentioned_stations: ['Chicago (Brown)'],
        first_seen_ts: NOW - 45 * 60_000,
        resolved_ts: NOW - 15 * 60_000,
        active: false,
        post_url: 'https://bsky.app/profile/did:plc:abc/post/brnriver',
      }),
      observations: [],
    },
    {
      id: 'busreroute',
      kind: 'bus',
      routes: ['2', '6'],
      first_seen_ts: NOW - 30 * 60_000,
      resolved_ts: NOW - 5 * 60_000,
      active: false,
      sources: ['cta'],
      cta: ctaBlock({
        alert_id: 'a2',
        headline: 'Temporary Reroute',
        short_description: 'SB State will be closed between Wacker and Randolph.',
        affected_from_station: 'Wacker',
        affected_to_station: 'Randolph',
        first_seen_ts: NOW - 30 * 60_000,
        resolved_ts: NOW - 5 * 60_000,
        active: false,
        post_url: 'https://bsky.app/profile/did:plc:abc/post/busreroute',
      }),
      observations: [],
    },
    {
      // Multi-line Loop incident: the CTA alert grouped with one pulse-cold
      // detection per line (Purple primary, Pink extra).
      id: 'loopevt',
      kind: 'train',
      routes: ['purple', 'pink'],
      first_seen_ts: NOW - 40 * 60_000,
      resolved_ts: NOW - 10 * 60_000,
      active: false,
      sources: ['cta', 'bot'],
      cta: ctaBlock({
        alert_id: 'loop1',
        headline: 'Loop Elevated Service Delayed',
        first_seen_ts: NOW - 40 * 60_000,
        resolved_ts: NOW - 10 * 60_000,
        active: false,
        post_url: 'https://bsky.app/profile/did:plc:abc/post/loopevt',
      }),
      observations: [
        {
          id: 201,
          kind: 'train',
          line: 'purple',
          from_station: 'Belmont (Red/Brown/Purple)',
          to_station: 'Chicago (Brown/Purple)',
          detection_source: 'pulse-cold',
          ts: NOW - 38 * 60_000,
          resolved_ts: NOW - 12 * 60_000,
          active: false,
          post_url: 'https://bsky.app/profile/did:plc:xyz/post/obsPurple',
        },
        {
          id: 202,
          kind: 'train',
          line: 'pink',
          from_station: 'Ashland (Green/Pink)',
          to_station: 'Washington/Wabash',
          detection_source: 'pulse-cold',
          ts: NOW - 36 * 60_000,
          resolved_ts: NOW - 12 * 60_000,
          active: false,
          post_url: 'https://bsky.app/profile/did:plc:xyz/post/obsPink',
        },
      ],
    },
    {
      id: 'bus99',
      kind: 'bus',
      routes: ['66'],
      first_seen_ts: NOW - 10 * 60_000,
      resolved_ts: null,
      active: true,
      sources: ['bot'],
      cta: null,
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
  // Unmount before restoring globals — EventPage installs a 5-minute
  // setInterval polling fetch, and the closure pins data + station index
  // until React tears the tree down. Without this, each test leaves a
  // multi-MB graph alive and the suite OOMs in CI.
  cleanup();
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

  it('aggregates affected stations across all merged observations', async () => {
    // The merged Loop incident pairs the alert with two pulse-cold obs on
    // different lines. The chips must list endpoints from BOTH (primary +
    // extra), not just the primary's Belmont/Chicago — otherwise a five-line
    // incident reads as one arbitrary stretch.
    render(<EventPage eventId="loopevt" />);
    await waitFor(() => {
      expect(screen.getByText('Loop Elevated Service Delayed')).toBeInTheDocument();
    });
    // Primary obs (Purple) endpoints.
    expect(screen.getByRole('link', { name: 'Belmont' })).toBeInTheDocument();
    // Extra obs (Pink) endpoint — proves we go beyond the primary observation.
    expect(screen.getByRole('link', { name: 'Washington/Wabash' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ashland' })).toBeInTheDocument();
  });

  it('renders the combined multi-line map for a multi-line incident', async () => {
    render(<EventPage eventId="loopevt" />);
    await waitFor(() => {
      expect(screen.getByText('Loop Elevated Service Delayed')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('img', { name: /Affected stretches across 2 train lines/ }),
    ).toBeInTheDocument();
    // Bot-detected stretches are labeled as observed impact, not "where this
    // happened" — they spread downstream of the CTA's reported epicenter.
    expect(screen.getByText('Bot observed impact')).toBeInTheDocument();
    expect(screen.queryByText('Where this happened')).not.toBeInTheDocument();
  });

  it('adds a cleared entry to the Per CTA timeline when the alert resolved', async () => {
    // The Brown Line alert is resolved with CTA body text. The timeline should
    // end on a "cleared" entry (newest) so it doesn't read as still ongoing.
    render(<EventPage eventId="brnriver" />);
    await waitFor(() => {
      expect(screen.getByText('CTA cleared this alert.')).toBeInTheDocument();
    });
    // Original message (1) + clear (1) = 2 updates.
    expect(screen.getByText(/Per CTA · 2 updates/)).toBeInTheDocument();
    // The CTA body text still renders in its version entry.
    expect(screen.getByText(/raised bridge/)).toBeInTheDocument();
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
