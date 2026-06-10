// Metra line metadata, keyed by the lowercase web key (the GTFS route_id
// lowercased — e.g. `up-n`, `md-w`, `bnsf`). Colors are Metra's official brand
// colors from the GTFS `routes.txt` (mirrors src/metra/lines.js in cta-insights);
// `textColor` is chosen for contrast on that background.
//
// Metra ships in alerts.json with raw route_ids (`UP-W`); `normalizeMetraLine`
// lowercases them at the data-read boundary so URLs and component keys are
// consistent. Unlike CTA's L lines, Metra lines aren't called "X Line", so the
// label is used as-is (no " Line" suffix).
export const METRA_LINES = {
  bnsf: { label: 'BNSF', color: '#29C233', textColor: '#000' },
  hc: { label: 'Heritage Corridor', color: '#550E0C', textColor: '#fff' },
  'md-n': { label: 'Milwaukee District North', color: '#CC5500', textColor: '#fff' },
  'md-w': { label: 'Milwaukee District West', color: '#F1AD0E', textColor: '#000' },
  me: { label: 'Metra Electric', color: '#EB5C00', textColor: '#fff' },
  ncs: { label: 'North Central Service', color: '#9785BC', textColor: '#fff' },
  ri: { label: 'Rock Island', color: '#E02400', textColor: '#fff' },
  sws: { label: 'SouthWest Service', color: '#0042A8', textColor: '#fff' },
  'up-n': { label: 'Union Pacific North', color: '#008000', textColor: '#fff' },
  'up-nw': { label: 'Union Pacific Northwest', color: '#FFE600', textColor: '#000' },
  'up-w': { label: 'Union Pacific West', color: '#FE8D81', textColor: '#000' },
};

// Row/display order (alphabetical by route_id, matching the backend).
export const METRA_LINE_ORDER = [
  'bnsf',
  'hc',
  'md-n',
  'md-w',
  'me',
  'ncs',
  'ri',
  'sws',
  'up-n',
  'up-nw',
  'up-w',
];

/**
 * Lowercase a Metra route_id to its web key (`UP-W` → `up-w`). Safe to call
 * repeatedly; passes null/undefined through.
 * @param {string} key
 * @returns {string}
 */
export function normalizeMetraLine(key) {
  return key == null ? key : String(key).toLowerCase();
}

/** Metadata for a Metra line by any-case route_id, or undefined. */
export function metraLineInfo(key) {
  return METRA_LINES[normalizeMetraLine(key)];
}
