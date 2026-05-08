import { describe, expect, it } from 'vitest';
import { findIncidentById, formatRoutesLabel, getEventId, postUrlRkey } from '../lib/incidents.js';

const ALERT_URL = 'https://bsky.app/profile/did:plc:abc/post/3ml5idb536d2c';
const OBS_URL = 'https://bsky.app/profile/did:plc:xyz/post/3mkuutqcneg2h';
const STANDALONE_OBS_URL = 'https://bsky.app/profile/did:plc:xyz/post/3mkomsa7xhv2i';

const NOW = 1_000_000_000_000;

const alert = {
  alert_id: 'a1',
  kind: 'train',
  routes: ['red'],
  headline: 'Red Line Delays',
  first_seen_ts: NOW - 60 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  post_url: ALERT_URL,
};

const matchingObs = {
  id: 1,
  kind: 'train',
  line: 'red',
  ts: NOW - 55 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  post_url: OBS_URL,
};

const standaloneObs = {
  id: 2,
  kind: 'bus',
  line: '66',
  ts: NOW - 10 * 60_000,
  resolved_ts: null,
  active: true,
  post_url: STANDALONE_OBS_URL,
};

describe('postUrlRkey', () => {
  it('extracts the rkey from a Bluesky post URL', () => {
    expect(postUrlRkey(ALERT_URL)).toBe('3ml5idb536d2c');
  });

  it('returns null for missing or malformed URLs', () => {
    expect(postUrlRkey(null)).toBeNull();
    expect(postUrlRkey(undefined)).toBeNull();
    expect(postUrlRkey('')).toBeNull();
    expect(postUrlRkey('https://bsky.app/profile/foo')).toBeNull();
  });

  it('stops at query strings and fragments', () => {
    expect(postUrlRkey(`${ALERT_URL}?utm=x`)).toBe('3ml5idb536d2c');
    expect(postUrlRkey(`${ALERT_URL}#anchor`)).toBe('3ml5idb536d2c');
  });
});

describe('getEventId', () => {
  it('prefers the alert post rkey', () => {
    expect(getEventId({ post_url: ALERT_URL, obs_post_url: OBS_URL })).toBe('3ml5idb536d2c');
  });

  it('falls back to obs_post_url when post_url is missing', () => {
    expect(getEventId({ obs_post_url: OBS_URL })).toBe('3mkuutqcneg2h');
  });

  it('returns null when neither url is present', () => {
    expect(getEventId({})).toBeNull();
    expect(getEventId(null)).toBeNull();
  });
});

describe('findIncidentById', () => {
  it('finds a merged incident by its alert post rkey', () => {
    const found = findIncidentById([alert], [matchingObs], '3ml5idb536d2c');
    expect(found).not.toBeNull();
    expect(found._type).toBe('merged');
    expect(found.alert_id).toBe('a1');
  });

  it('finds a standalone observation by its post rkey', () => {
    const found = findIncidentById([], [standaloneObs], '3mkomsa7xhv2i');
    expect(found).not.toBeNull();
    expect(found.id).toBe(2);
  });

  it('returns null for an unknown id', () => {
    expect(findIncidentById([alert], [matchingObs], 'nope')).toBeNull();
  });

  it('returns null for a falsy id', () => {
    expect(findIncidentById([alert], [matchingObs], '')).toBeNull();
    expect(findIncidentById([alert], [matchingObs], null)).toBeNull();
  });
});

describe('formatRoutesLabel', () => {
  it('single bus route uses verbose name', () => {
    expect(formatRoutesLabel('bus', ['3'])).toBe('#3 King Drive');
  });
  it('two bus routes joins with "and"', () => {
    expect(formatRoutesLabel('bus', ['136', '147'])).toBe('#136 and #147');
  });
  it('three bus routes uses comma list', () => {
    expect(formatRoutesLabel('bus', ['136', '147', '151'])).toBe('#136, #147, #151');
  });
  it('four+ bus routes truncates with overflow count', () => {
    expect(formatRoutesLabel('bus', ['1', '3', '4', '7', '147'])).toBe('#1, #3 + 3 more');
  });
  it('single train line', () => {
    expect(formatRoutesLabel('train', ['red'])).toBe('Red Line');
  });
  it('two train lines pluralizes', () => {
    // Routes here are full-name keys after normalizeAlertsPayload (the bot
    // emits short codes; normalization at fetch time turns them into full
    // names like `purple`).
    expect(formatRoutesLabel('train', ['red', 'purple'])).toBe('Red and Purple Lines');
  });
  it('empty routes falls back to generic', () => {
    expect(formatRoutesLabel('bus', [])).toBe('this route');
    expect(formatRoutesLabel('train', [])).toBe('this line');
  });
});
