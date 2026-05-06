import { TRAIN_LINE_ORDER } from './ctaLines.js';

const VALID_RANGES = new Set([7, 30, 60, 90]);
const TRAIN_LINE_SET = new Set(TRAIN_LINE_ORDER);

// Bus visibility defaults to hidden when the user has narrowed to a specific
// set of train lines — otherwise a "Red Line view" link surfaces unrelated
// bus disruptions on the other side of the city. Returns true when the
// default should be "show buses".
function defaultShowBus(selectedLines) {
  return !(selectedLines !== null && selectedLines.length > 0);
}

export { defaultShowBus };

// Parse URLSearchParams into the same shape App holds in state. Unknown values
// are dropped silently — a stale or hand-edited URL falls back to defaults
// rather than crashing.
export function parseUrlState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const out = {
    selectedLines: null,
    showBus: true,
    selectedBusRoutes: [],
    dateRange: 90,
  };

  const linesParam = params.get('lines');
  if (linesParam === 'none') {
    out.selectedLines = [];
  } else if (linesParam) {
    const valid = linesParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => TRAIN_LINE_SET.has(s));
    if (valid.length > 0) out.selectedLines = valid;
  }

  // Bus visibility: explicit param wins; otherwise contextual default based
  // on whether train lines are narrowed.
  const busParam = params.get('bus');
  if (busParam === '0') out.showBus = false;
  else if (busParam === '1') out.showBus = true;
  else out.showBus = defaultShowBus(out.selectedLines);

  const routesParam = params.get('routes');
  if (routesParam) {
    out.selectedBusRoutes = routesParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  }

  const rangeParam = params.get('range');
  if (rangeParam === 'all') {
    out.dateRange = null;
  } else if (rangeParam) {
    const n = Number(rangeParam);
    if (VALID_RANGES.has(n)) out.dateRange = n;
  }

  return out;
}

// Build a URLSearchParams string for the given state. Defaults are omitted so
// the bare URL stays clean and shareable. Returns "" when everything is at
// default (no leading "?").
export function buildSearch({ selectedLines, showBus, selectedBusRoutes, dateRange }) {
  const params = new URLSearchParams();

  if (selectedLines !== null) {
    params.set('lines', selectedLines.length === 0 ? 'none' : selectedLines.join(','));
  }
  // Only emit `bus` when it differs from the contextual default — keeps
  // URLs clean for the common cases.
  if (showBus !== defaultShowBus(selectedLines)) {
    params.set('bus', showBus ? '1' : '0');
  }
  if (selectedBusRoutes && selectedBusRoutes.length > 0) {
    params.set('routes', selectedBusRoutes.join(','));
  }
  if (dateRange !== 90) {
    params.set('range', dateRange === null ? 'all' : String(dateRange));
  }

  const s = params.toString();
  return s ? `?${s}` : '';
}
