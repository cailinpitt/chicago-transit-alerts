import { describe, expect, it } from 'vitest';
import { findIncidentById, getEventId, postUrlRkey } from '../lib/incidents.js';

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
