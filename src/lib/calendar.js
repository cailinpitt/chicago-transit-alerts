// Helpers for the /calendar page. Reads the slim daily-counts.json
// produced by cta-insights/bin/export-daily.js and shapes it into a
// 12-month grid keyed by Chicago calendar day.

import { normalizeTrainLine } from './ctaLines.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Parse "YYYY-MM-DD" → UTC-midnight epoch encoding that Chicago Y/M/D
// (same convention as chicagoDayUTC). Returns null on malformed input.
export function dateStringToUtc(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return utc;
}

// Index `days` array by date string for O(1) lookup during grid build.
function indexDays(days) {
  const out = new Map();
  for (const d of days || []) {
    if (d?.date) out.set(d.date, d);
  }
  return out;
}

// Apply the homepage filter set to a daily-counts record. Returns
// `{ trainCount, busCount }` reflecting only the selected lines/routes.
// Recognizes the same filter keys parseUrlState produces — line keys are
// normalized to full names (`green`, not `g`), but daily-counts.json still
// uses CTA short codes inside `by_line`, so the comparison walks both.
//
//   selectedLines     null = all train lines; [] = no train lines.
//   showBus           false = drop all bus counts.
//   selectedBusRoutes non-empty = restrict bus counts to these routes.
//
// Signal filtering is intentionally not supported here — daily-counts.json
// doesn't carry per-signal breakdowns. The calendar page surfaces a small
// note when signals are active so the user understands why the calendar
// isn't responsive to that one filter chip.
function filterCounts(day, { selectedLines, showBus, selectedBusRoutes }) {
  let trainCount = 0;
  if (selectedLines === null) {
    // All train lines pass.
    trainCount = day.train_count || 0;
  } else if (selectedLines.length > 0 && day.by_line && typeof day.by_line === 'object') {
    const wanted = new Set(selectedLines.map(normalizeTrainLine));
    for (const [k, v] of Object.entries(day.by_line)) {
      if (wanted.has(normalizeTrainLine(k))) trainCount += v;
    }
  }

  let busCount = 0;
  if (showBus) {
    if (!selectedBusRoutes || selectedBusRoutes.length === 0) {
      busCount = day.bus_count || 0;
    } else if (day.by_route && typeof day.by_route === 'object') {
      for (const [k, v] of Object.entries(day.by_route)) {
        if (selectedBusRoutes.includes(k)) busCount += v;
      }
    }
  }

  return { trainCount, busCount };
}

// Build a calendar grid covering the most recent `monthsBack` months ending
// in the current month. Returns an array of months, newest first, each with
// a year/month label and a fixed-length 31-cell row. Cells covering days
// that don't exist in that month (e.g. Feb 30) get a `placeholder: true`
// flag so the renderer can skip them. Cells that ended on or before
// `dataStartTs` get `noData: true` so the renderer can hatch them.
//
// `now` defaults to Date.now() — pinned to Chicago calendar terms via the
// payload's date strings, so timezone of `now` doesn't matter for cell
// alignment, only for "what's the current month."
//
// `filters` mirrors the homepage filter set; passing it narrows each cell's
// count to only the selected lines/routes (uses each day's by_line/by_route
// breakdowns). Default keeps the original "all train + all bus" behavior.
/**
 * @param {{ date: string, train_count: number, bus_count: number, by_line?: object, by_route?: object }[]} days
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.monthsBack]
 * @param {number | null} [options.dataStartTs]
 * @param {{ selectedLines: string[] | null, showBus: boolean, selectedBusRoutes: string[] } | null} [options.filters]
 * @returns {Array<{
 *   year: number,
 *   month: number,
 *   label: string,
 *   cells: Array<{
 *     dayOfMonth: number,
 *     date: string | null,
 *     count: number,
 *     trainCount: number,
 *     busCount: number,
 *     placeholder: boolean,
 *     noData: boolean,
 *     future: boolean,
 *   }>,
 * }>}
 */
export function buildCalendarMonths(
  days,
  { now = Date.now(), monthsBack = 12, dataStartTs = null, filters = null } = {},
) {
  const idx = indexDays(days);
  const today = new Date(now);
  // Anchor month uses Chicago-local Y/M to avoid edge-of-month drift.
  const anchorParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const anchorYear = Number(anchorParts.find((p) => p.type === 'year').value);
  const anchorMonth = Number(anchorParts.find((p) => p.type === 'month').value);
  const anchorDay = Number(anchorParts.find((p) => p.type === 'day').value);
  const todayUtc = Date.UTC(anchorYear, anchorMonth - 1, anchorDay);

  const monthLabelFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });

  const out = [];
  // Walk backwards from the current month for `monthsBack` rows. Newest first
  // so the page opens with the most recent activity visible.
  for (let i = 0; i < monthsBack; i++) {
    let y = anchorYear;
    let m = anchorMonth - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let d = 1; d <= 31; d++) {
      if (d > daysInMonth) {
        cells.push({
          dayOfMonth: d,
          date: null,
          count: 0,
          trainCount: 0,
          busCount: 0,
          placeholder: true,
          noData: false,
          future: false,
        });
        continue;
      }
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayUtc = Date.UTC(y, m - 1, d);
      const future = dayUtc > todayUtc;
      const dayEnd = dayUtc + DAY_MS;
      const noData = !future && dataStartTs != null && dayEnd <= dataStartTs;
      const rec = idx.get(date);
      const { trainCount, busCount } = rec
        ? filters
          ? filterCounts(rec, filters)
          : { trainCount: rec.train_count || 0, busCount: rec.bus_count || 0 }
        : { trainCount: 0, busCount: 0 };
      cells.push({
        dayOfMonth: d,
        date,
        count: trainCount + busCount,
        trainCount,
        busCount,
        placeholder: false,
        noData,
        future,
      });
    }
    out.push({
      year: y,
      month: m,
      label: monthLabelFmt.format(new Date(Date.UTC(y, m - 1, 1))),
      cells,
    });
  }

  return out;
}

// Highest count across all real cells in a calendar grid — used to scale
// the cell-coloring intensity stops. Ignores placeholder/noData/future
// cells so an empty future month doesn't compress the visible scale.
export function maxCountAcrossMonths(months) {
  let max = 0;
  for (const month of months) {
    for (const cell of month.cells) {
      if (cell.placeholder || cell.noData || cell.future) continue;
      if (cell.count > max) max = cell.count;
    }
  }
  return max;
}
