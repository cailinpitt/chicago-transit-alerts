// CTA train line metadata, keyed by the full name. `color` is the official
// CTA brand hex; `textColor` is chosen for contrast on that background.
//
// CTA's API and our cta-bot pipeline use short codes — Brn / G / Org / P / Y
// — that get written to alerts.json as `'brn'`, `'g'`, `'org'`, `'p'`, `'y'`.
// We expand those to full names at the data-read boundary (see
// `normalizeTrainLine`) so URLs, filter state, and component IDs all read
// naturally; the data file format stays compatible with the bot.
export const TRAIN_LINES = {
  red: { label: 'Red', color: '#C60C30', textColor: '#fff' },
  blue: { label: 'Blue', color: '#00A1DE', textColor: '#fff' },
  brown: { label: 'Brown', color: '#62361B', textColor: '#fff' },
  green: { label: 'Green', color: '#009B3A', textColor: '#fff' },
  orange: { label: 'Orange', color: '#F9461C', textColor: '#fff' },
  pink: { label: 'Pink', color: '#E27EA6', textColor: '#fff' },
  purple: { label: 'Purple', color: '#522398', textColor: '#fff' },
  yellow: { label: 'Yellow', color: '#F9E300', textColor: '#000' },
};

// Order determines row order in the timeline grid.
export const TRAIN_LINE_ORDER = [
  'red',
  'blue',
  'brown',
  'green',
  'orange',
  'pink',
  'purple',
  'yellow',
];

// CTA short-code → full-name aliases for the five lines whose API codes
// don't already match. Identity for the other three so callers can pass
// any incoming key without branching.
const LINE_ALIAS = {
  brn: 'brown',
  g: 'green',
  org: 'orange',
  p: 'purple',
  y: 'yellow',
};

/**
 * Normalize a train line key to its full-name form. Accepts short codes from
 * the CTA pipeline (`'g'`, `'org'`, `'p'`, `'brn'`, `'y'`) plus the full
 * names directly so it's safe to call repeatedly. Unknown keys pass
 * through unchanged.
 *
 * @param {string} key
 * @returns {string}
 */
export function normalizeTrainLine(key) {
  if (key == null) return key;
  return LINE_ALIAS[key] ?? key;
}
