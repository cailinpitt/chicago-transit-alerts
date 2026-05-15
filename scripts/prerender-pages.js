// Prerender per-page HTML stubs and OG images for /line/:id, /route/:id,
// /station/:slug, /calendar, and /stats so social media crawlers get
// page-specific cards instead of the generic homepage one. Same pattern as
// prerender-events.js: emit an HTML stub at <route>/index.html with
// rewritten OG meta, plus og.png next to it. PNGs are signature-cached so
// unchanged pages skip Playwright.
//
// Scope (intentionally bounded — generating 150+ bus routes when only a few
// are ever shared would be wasteful):
//   - All 8 train lines (stable set, always rendered)
//   - Bus routes that appear in alerts/observations within the 90-day window
//   - Stations from buildStationIndex (already filtered to >=1 incident)
//   - /calendar (singleton, always rendered)
//   - /stats (singleton, always rendered)
//   - /compare (singleton, always rendered)
//   - /system/trains and /system/buses (singletons, always rendered)
//
// Anything outside the scope falls back to the generic homepage OG card,
// which the SPA shell at the unknown route serves by default.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { computeStatsLeaderboards } from '../src/lib/aggregate.js';
import { BUS_ROUTE_NAMES } from '../src/lib/busRoutes.js';
import { buildCalendarMonths, maxCountAcrossMonths } from '../src/lib/calendar.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../src/lib/ctaLines.js';
import { chicagoDayUTC, formatChicagoDay, formatDuration } from '../src/lib/format.js';
import {
  formatRoutesLabel,
  mergeMatchingIncidents,
  normalizeAlertsPayload,
} from '../src/lib/incidents.js';
import { buildStationIndex } from '../src/lib/stations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const DATA = resolve(DIST, 'data', 'alerts.json');
const DAILY_DATA = resolve(DIST, 'data', 'daily-counts.json');
const SHELL = resolve(DIST, 'index.html');
const LINE_TPL = resolve(__dirname, 'og-line-template.html');
const STATION_TPL = resolve(__dirname, 'og-station-template.html');
const CALENDAR_TPL = resolve(__dirname, 'og-calendar-template.html');
const STATS_TPL = resolve(__dirname, 'og-stats-template.html');
const COMPARE_TPL = resolve(__dirname, 'og-compare-template.html');
const DAY_TPL = resolve(__dirname, 'og-day-template.html');
const SYSTEM_TPL = resolve(__dirname, 'og-system-template.html');
const CACHE = resolve(ROOT, '.og-cache-pages');
const CONCURRENCY = Number(process.env.PRERENDER_CONCURRENCY ?? 6);

const SITE = 'https://chicagotransitalerts.app';
const BUS_ACCENT = { color: '#475569', soft: 'rgba(71, 85, 105, 0.18)', text: '#fff' };

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function softColor(hex, alpha = 0.18) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Mirrors CalendarPage's cellBg — five intensity stops keyed off max. Kept
// inline here (not imported) because the page consumes it as a CSS variable;
// here we want a literal color string for HTML style attributes.
function calendarCellColor(count, maxCount) {
  if (count === 0 || maxCount <= 0) return '#e2e8f0';
  const ratio = count / maxCount;
  if (ratio < 0.2) return 'rgba(100, 116, 139, 0.25)';
  if (ratio < 0.4) return 'rgba(100, 116, 139, 0.45)';
  if (ratio < 0.7) return 'rgba(100, 116, 139, 0.65)';
  if (ratio < 0.9) return 'rgba(100, 116, 139, 0.85)';
  return 'rgb(71, 85, 105)';
}

// Render the 12-month grid as HTML the OG template can drop in. Uses the
// same buildCalendarMonths logic the live page uses, so the share image
// shows the actual data — busy days dark, sparse months mostly empty.
function buildCalendarGridHtml(dailyPayload) {
  const months = buildCalendarMonths(dailyPayload?.days ?? [], {
    monthsBack: 12,
    dataStartTs: dailyPayload?.data_start_ts ?? null,
  });
  const maxCount = maxCountAcrossMonths(months);
  const labelFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  });
  const rows = months.map((m) => {
    const label = labelFmt.format(new Date(Date.UTC(m.year, m.month - 1, 1)));
    const cells = m.cells
      .map((cell) => {
        if (cell.placeholder || cell.future) return '<div class="cell future"></div>';
        if (cell.noData) return '<div class="cell no-data"></div>';
        const bg = calendarCellColor(cell.count, maxCount);
        return `<div class="cell" style="background:${bg}"></div>`;
      })
      .join('');
    return `<div class="month-row"><div class="month-label">${escHtml(label)}</div>${cells}</div>`;
  });
  return rows.join('');
}

// Render the four-stat leaderboard as HTML for the OG card. Mirrors the
// shape of StatsPage but flattened to two label/value rows per cell.
const STATS_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function statsHour(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function buildStatsHtml(leaders) {
  const items = [];
  if (leaders.worstDay) {
    items.push({
      label: 'Worst day',
      value: `${formatChicagoDay(leaders.worstDay.dayUtc)} · ${leaders.worstDay.count} incident${leaders.worstDay.count === 1 ? '' : 's'}`,
    });
  } else {
    items.push({ label: 'Worst day', value: 'Not enough data yet' });
  }
  if (leaders.worstHour) {
    items.push({
      label: 'Worst hour',
      value: `${STATS_DAYS[leaders.worstHour.weekday]} ${statsHour(leaders.worstHour.hour)} · ${leaders.worstHour.count} incident${leaders.worstHour.count === 1 ? '' : 's'}`,
    });
  } else {
    items.push({ label: 'Worst hour', value: 'Not enough data yet' });
  }
  if (leaders.worstStation) {
    items.push({
      label: 'Most-affected station',
      value: `${leaders.worstStation.name} · ${leaders.worstStation.count} incident${leaders.worstStation.count === 1 ? '' : 's'}`,
    });
  } else {
    items.push({ label: 'Most-affected station', value: 'No station data yet' });
  }
  if (leaders.longestIncident) {
    const routes = formatRoutesLabel(leaders.longestIncident.kind, leaders.longestIncident.routes);
    items.push({
      label: 'Longest incident',
      value: `${routes} · ${formatDuration(leaders.longestIncident.durationMs)}`,
    });
  } else {
    items.push({ label: 'Longest incident', value: 'No resolved incidents yet' });
  }
  return items
    .map(
      (it) =>
        `<div class="stat"><p class="stat-eyebrow">${escHtml(it.label)}</p><p class="stat-value">${escHtml(it.value)}</p></div>`,
    )
    .join('');
}

function statsSubtitle(payload) {
  const total = (payload.alerts?.length ?? 0) + (payload.observations?.length ?? 0);
  if (total === 0) return 'Worst days, hours, stations, and longest incidents on record.';
  return `Worst days, hours, stations, and longest incidents — across ${total} record${total === 1 ? '' : 's'}.`;
}

function calendarSubtitle(dailyPayload) {
  let total = 0;
  for (const d of dailyPayload?.days ?? []) {
    total += (d.train_count || 0) + (d.bus_count || 0);
  }
  const span = (dailyPayload?.days ?? []).length;
  if (total === 0) return 'Daily incident heatmap';
  return `${total} incident${total === 1 ? '' : 's'} across ${span} day${span === 1 ? '' : 's'}`;
}

// Compute which train lines and bus routes currently have an active
// disruption (alert or observation that hasn't resolved). The OG card
// switches into an "Active disruption" variant for those, so a shared
// link surfaces the in-progress state instead of a stale-looking card.
function activeRoutesByKind(payload) {
  const trains = new Set();
  const buses = new Set();
  for (const a of payload.alerts ?? []) {
    if (!a.active) continue;
    if (a.kind === 'train') for (const r of a.routes ?? []) trains.add(r);
    else if (a.kind === 'bus') for (const r of a.routes ?? []) buses.add(String(r));
  }
  for (const o of payload.observations ?? []) {
    if (!o.active || !o.line) continue;
    if (o.kind === 'train') trains.add(o.line);
    else if (o.kind === 'bus') buses.add(String(o.line));
  }
  return { trains, buses };
}

// Build the list of line/route/station "pages" to render. Each item carries
// everything the renderer needs: a stable slug for the cache key and output
// path, the raw input fields, and the kind so we pick the right template.
function planPages(payload, dailyPayload) {
  const now = Date.now();
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const pages = [];
  const { trains: activeTrains, buses: activeBuses } = activeRoutesByKind(payload);

  // Calendar — singleton page. Always rendered so a fresh deploy never
  // ships without its share card. The grid HTML is computed up front and
  // baked into the signature so a content change re-renders the PNG.
  if (dailyPayload) {
    const gridHtml = buildCalendarGridHtml(dailyPayload);
    const subtitle = calendarSubtitle(dailyPayload);
    pages.push({
      kind: 'calendar',
      slug: 'calendar',
      outDir: resolve(DIST, 'calendar'),
      url: `${SITE}/calendar`,
      path: '/calendar',
      ogTitle: '12-Month Calendar · Chicago Transit Alerts',
      desc: 'A 12-month heatmap of daily CTA service alerts and bot-detected disruptions — archived on chicagotransitalerts.app.',
      subtitle,
      gridHtml,
    });
  }

  // Compare — singleton page. Template is fully static (no per-build data
  // baked into the card); we just emit it so /compare gets its own OG image
  // for social sharing instead of the homepage card. Skipped if the template
  // file is missing (defensive — the template ships with the repo).
  if (existsSync(COMPARE_TPL)) {
    pages.push({
      kind: 'compare',
      slug: 'compare',
      outDir: resolve(DIST, 'compare'),
      url: `${SITE}/compare`,
      path: '/compare',
      ogTitle: 'Compare CTA lines · Chicago Transit Alerts',
      desc: 'Side-by-side reliability, signal mix, and resolution time for up to 3 CTA train lines or bus routes — archived on chicagotransitalerts.app.',
      subtitle: '',
    });
  }

  // System-health pages — one card per mode (train / bus). Trains get the
  // 8 brand-color line pills; buses get the top-N most-active route pills,
  // capped so the card never overflows. Both share a single template.
  {
    const trainPills = TRAIN_LINE_ORDER.map((lineId) => {
      const info = TRAIN_LINES[lineId];
      if (!info) return '';
      return `<span class="pill" style="background:${info.color};color:${info.textColor}">${escHtml(info.label)}</span>`;
    }).join('');
    // Bus pill set: generic service-type categories rather than specific
    // route numbers. Naming a handful of routes on the card implied those
    // were the only ones covered — they're not; every route with recent
    // activity gets a row on the page. Categories convey the breadth of
    // the bus network without singling anyone out.
    const BUS_CATEGORIES = ['Local', 'Express', 'Limited', 'Owl service'];
    const busPills = BUS_CATEGORIES.map(
      (label) =>
        `<span class="pill" style="background:#475569;color:#fff">${escHtml(label)}</span>`,
    ).join('');
    // Total bus-route count drives the subtitle. Computed across the same
    // 90-day window the page itself uses, so the card's claim matches what
    // a visitor sees when they arrive.
    const busRoutesInWindow = new Set();
    const cutoffNinety = now - WINDOW_DAYS * DAY_MS;
    for (const a of payload.alerts ?? []) {
      if (a.kind !== 'bus' || (a.first_seen_ts ?? 0) < cutoffNinety) continue;
      for (const r of a.routes ?? []) busRoutesInWindow.add(String(r));
    }
    for (const o of payload.observations ?? []) {
      if (o.kind !== 'bus' || !o.line || (o.ts ?? 0) < cutoffNinety) continue;
      busRoutesInWindow.add(String(o.line));
    }
    const totalBusRoutes = busRoutesInWindow.size;

    pages.push({
      kind: 'system',
      mode: 'train',
      slug: 'system-trains',
      outDir: resolve(DIST, 'system', 'trains'),
      url: `${SITE}/system/trains`,
      path: '/system/trains',
      ogTitle: 'Train system health · Chicago Transit Alerts',
      desc: 'System-wide health for the L: active disruptions, per-line incident counts, disruption hours, and 30-day trends — archived on chicagotransitalerts.app.',
      title: 'Train system health',
      subtitle: 'All eight L lines at a glance — active disruptions, recent activity, and 30-day disruption time.',
      pillHtml: trainPills,
      // Trains: a wash of the L brand colors across the card, plus a
      // vertical multi-stop bar mirroring the same palette so the card
      // reads as "the L" at a glance.
      bgGradient:
        'linear-gradient(120deg, rgba(198, 12, 48, 0.12) 0%, rgba(249, 70, 28, 0.10) 28%, rgba(0, 161, 222, 0.12) 55%, rgba(82, 35, 152, 0.12) 82%, rgba(0, 155, 58, 0.10) 100%)',
      accentBar:
        'linear-gradient(180deg, #C60C30 0%, #F9461C 18%, #62361B 32%, #009B3A 50%, #00A1DE 68%, #522398 82%, #E27EA6 92%, #F9E300 100%)',
    });
    pages.push({
      kind: 'system',
      mode: 'bus',
      slug: 'system-buses',
      outDir: resolve(DIST, 'system', 'buses'),
      url: `${SITE}/system/buses`,
      path: '/system/buses',
      ogTitle: 'Bus system health · Chicago Transit Alerts',
      desc: 'System-wide health for CTA buses: active disruptions, per-route incident counts, disruption hours, and 30-day trends — archived on chicagotransitalerts.app.',
      title: 'Bus system health',
      subtitle:
        totalBusRoutes > 0
          ? `${totalBusRoutes} bus route${totalBusRoutes === 1 ? '' : 's'} with recent activity — active disruptions, incident counts, and 30-day disruption time.`
          : 'Active disruptions, incident counts, and 30-day disruption time for every bus route on record.',
      pillHtml: busPills,
      // Buses share the muted slate identity used for bus pills on the
      // site itself, with a hint of warmth toward the bottom to keep the
      // card from reading as monochrome.
      bgGradient:
        'linear-gradient(135deg, rgba(71, 85, 105, 0.18) 0%, rgba(100, 116, 139, 0.10) 45%, rgba(249, 115, 22, 0.10) 100%)',
      accentBar: 'linear-gradient(180deg, #334155 0%, #64748b 60%, #f97316 100%)',
    });
  }

  // Stats / leaderboards — also a singleton. Reuses the same leaderboard
  // function the live page calls so the share image and the page agree.
  const leaders = computeStatsLeaderboards(payload.alerts ?? [], payload.observations ?? [], {
    now,
    windowDays: WINDOW_DAYS,
  });
  const statsHtml = buildStatsHtml(leaders);
  pages.push({
    kind: 'stats',
    slug: 'stats',
    outDir: resolve(DIST, 'stats'),
    url: `${SITE}/stats`,
    path: '/stats',
    ogTitle: 'Stats · Chicago Transit Alerts',
    desc: 'Worst days, hours, stations, and longest incidents on the CTA — archived on chicagotransitalerts.app.',
    subtitle: statsSubtitle(payload),
    statsHtml,
  });

  // Train lines: always all of them — small stable set, deserves full coverage.
  for (const lineId of TRAIN_LINE_ORDER) {
    const info = TRAIN_LINES[lineId];
    if (!info) continue;
    const active = activeTrains.has(lineId);
    pages.push({
      kind: 'line',
      slug: `line-${lineId}`,
      outDir: resolve(DIST, 'line', lineId),
      url: `${SITE}/line/${lineId}`,
      path: `/line/${lineId}`,
      label: `${info.label} Line`,
      // Train pill already says "Red Line"; an additional headline would
      // be redundant. Leave the title empty so the template hides it.
      title: '',
      ogTitle: `${info.label} Line · Chicago Transit Alerts`,
      desc: `Service alerts and bot-detected disruptions on the ${info.label} Line — archived on chicagotransitalerts.app.`,
      subtitle: active
        ? 'Active disruption right now — see live status.'
        : 'Service alerts and bot-detected disruptions, archived.',
      accent: { color: info.color, soft: softColor(info.color, 0.22), text: info.textColor },
      active,
    });
  }

  // Bus routes with at least one incident in the window. Sorted leading-numeric
  // for deterministic build output (helps caching when nothing's changed).
  const busRoutes = new Set();
  for (const o of payload.observations || []) {
    if (o.kind === 'bus' && o.line && o.ts >= cutoff) busRoutes.add(o.line);
  }
  for (const a of payload.alerts || []) {
    if (a.kind !== 'bus' || a.first_seen_ts < cutoff) continue;
    for (const r of a.routes || []) busRoutes.add(r);
  }
  for (const route of [...busRoutes].sort()) {
    const name = BUS_ROUTE_NAMES[route] ?? BUS_ROUTE_NAMES[String(route)];
    // Pill stays compact ("#10") so it doesn't overflow with long CTA route
    // names like "Obama Presidential Center/Museum of Science & Industry".
    // The full name lives in the title slot underneath, where it can wrap
    // and clamp gracefully.
    const ogLabel = name ? `#${route} ${name}` : `#${route}`;
    const active = activeBuses.has(String(route));
    pages.push({
      kind: 'route',
      slug: `route-${route}`,
      outDir: resolve(DIST, 'route', String(route)),
      url: `${SITE}/route/${route}`,
      path: `/route/${route}`,
      label: `#${route}`,
      title: name ?? '',
      ogTitle: `${ogLabel} · Chicago Transit Alerts`,
      desc: `Service alerts and bot-detected disruptions on the ${ogLabel} bus route — archived on chicagotransitalerts.app.`,
      subtitle: active
        ? 'Active disruption right now — see live status.'
        : 'Service alerts and bot-detected disruptions, archived.',
      accent: BUS_ACCENT,
      active,
    });
  }

  // Day pages — every Chicago calendar day in the rolling window that had at
  // least one incident. Skipped when the merge step yields nothing for that
  // day, so a zero-incident day doesn't claim a share card.
  const DAY_PRERENDER_WINDOW_DAYS = 30;
  const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
    payload.alerts ?? [],
    payload.observations ?? [],
  );
  const daysWithIncidents = new Map(); // dayUtc → { trainLines: Set, busRoutes: Set, count }
  function bumpDay(ts, kind, routes) {
    if (ts == null) return;
    const day = chicagoDayUTC(ts);
    if (day < chicagoDayUTC(now) - (DAY_PRERENDER_WINDOW_DAYS - 1) * DAY_MS) return;
    if (day > chicagoDayUTC(now)) return;
    let entry = daysWithIncidents.get(day);
    if (!entry) {
      entry = { trainLines: new Set(), busRoutes: new Set(), count: 0 };
      daysWithIncidents.set(day, entry);
    }
    entry.count += 1;
    for (const r of routes ?? []) {
      if (kind === 'train') entry.trainLines.add(r);
      else if (kind === 'bus') entry.busRoutes.add(String(r));
    }
  }
  for (const m of merged) bumpDay(m.first_seen_ts, m.kind, m.routes);
  for (const a of standaloneAlerts) bumpDay(a.first_seen_ts, a.kind, a.routes);
  for (const o of standaloneObs) bumpDay(o.first_seen_ts ?? o.ts, o.kind, o.line ? [o.line] : []);

  for (const [dayUtc, entry] of [...daysWithIncidents].sort((a, b) => b[0] - a[0])) {
    const d = new Date(dayUtc);
    const isoDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const pillHtml = [
      ...[...entry.trainLines]
        .map((line) => {
          const info = TRAIN_LINES[line];
          if (!info) return null;
          return `<span class="line-pill" style="background:${info.color};color:${info.textColor}">${escHtml(info.label)}</span>`;
        })
        .filter(Boolean),
      ...[...entry.busRoutes]
        .sort()
        .slice(0, 8)
        .map(
          (route) =>
            `<span class="line-pill" style="background:#475569;color:#fff">#${escHtml(route)}</span>`,
        ),
    ].join('');
    pages.push({
      kind: 'day',
      slug: `day-${isoDate}`,
      outDir: resolve(DIST, 'day', isoDate),
      url: `${SITE}/day/${isoDate}`,
      path: `/day/${isoDate}`,
      ogTitle: `${formatChicagoDay(dayUtc)} · Chicago Transit Alerts`,
      desc: `CTA service alerts and bot-detected disruptions on ${formatChicagoDay(dayUtc)} — archived on chicagotransitalerts.app.`,
      title: formatChicagoDay(dayUtc),
      subtitle: `${entry.count} incident${entry.count === 1 ? '' : 's'} across ${entry.trainLines.size + entry.busRoutes.size} line${entry.trainLines.size + entry.busRoutes.size === 1 ? '' : 's'}/route${entry.trainLines.size + entry.busRoutes.size === 1 ? '' : 's'}`,
      pillHtml,
    });
  }

  // Stations from the index (already filtered to >=1 incident in 90d).
  const stationIndex = buildStationIndex(payload.alerts, payload.observations, {
    now,
    windowDays: WINDOW_DAYS,
  });
  for (const [slug, rec] of [...stationIndex].sort((a, b) => a[0].localeCompare(b[0]))) {
    const linePills = rec.lines
      .map((line) => {
        const info = TRAIN_LINES[line];
        if (!info) return null;
        return `<span class="line-pill" style="background:${info.color};color:${info.textColor}">${escHtml(info.label)}</span>`;
      })
      .filter(Boolean)
      .join('');
    pages.push({
      kind: 'station',
      slug: `station-${slug}`,
      outDir: resolve(DIST, 'station', slug),
      url: `${SITE}/station/${slug}`,
      path: `/station/${slug}`,
      stationName: rec.name,
      linePills,
      ogTitle: `${rec.name} · Chicago Transit Alerts`,
      desc: `Service alerts and bot-detected disruptions at ${rec.name} — archived on chicagotransitalerts.app.`,
      subtitle: `Train station · ${rec.count} incident${rec.count === 1 ? '' : 's'} on record (90d)`,
    });
  }

  return pages;
}

function buildHtmlStub(shell, page) {
  const image = `${page.url}/og.png`;
  const ogTitle = page.ogTitle.slice(0, 200);
  const desc = page.desc.slice(0, 280);
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(ogTitle)}</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escAttr(page.url)}" />`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escAttr(page.url)}" />`,
    )
    .replace(
      /<meta property="og:image"[^>]*>/g,
      `<meta property="og:image" content="${escAttr(image)}" />`,
    )
    .replace(
      /<meta property="og:image:alt"[^>]*>/,
      `<meta property="og:image:alt" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escAttr(ogTitle)}" />`,
    )
    .replace(
      /<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escAttr(desc)}" />`,
    )
    .replace(
      /<meta name="twitter:image"[^>]*>/g,
      `<meta name="twitter:image" content="${escAttr(image)}" />`,
    )
    .replace(
      /<meta name="twitter:image:alt"[^>]*>/,
      `<meta name="twitter:image:alt" content="${escAttr(ogTitle)}" />`,
    );
}

const ACTIVE_RIBBON_HTML =
  '<div class="active-ribbon"><span class="dot"></span>Active disruption</div>';

function fillLineTemplate(tpl, page) {
  return tpl
    .replaceAll('__ACCENT__', page.accent.color)
    .replaceAll('__ACCENT_SOFT__', page.accent.soft)
    .replaceAll('__ACCENT_TEXT__', page.accent.text)
    .replaceAll('__LABEL__', escHtml(page.label))
    .replaceAll('__TITLE__', escHtml(page.title ?? ''))
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__PATH__', escHtml(page.path))
    .replaceAll('__ACTIVE_RIBBON__', page.active ? ACTIVE_RIBBON_HTML : '');
}

function fillStationTemplate(tpl, page) {
  return tpl
    .replaceAll('__STATION_NAME__', escHtml(page.stationName))
    .replaceAll('__LINE_PILLS__', page.linePills)
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__PATH__', escHtml(page.path));
}

function fillCalendarTemplate(tpl, page) {
  return tpl
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__GRID__', page.gridHtml);
}

function fillStatsTemplate(tpl, page) {
  return tpl
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__STATS__', page.statsHtml);
}

// Compare template is static — no placeholders to fill. The function exists
// for symmetry with the others and to give us a hook if we ever want to
// make the card per-combination later.
function fillCompareTemplate(tpl) {
  return tpl;
}

function fillSystemTemplate(tpl, page) {
  return tpl
    .replaceAll('__BG_GRADIENT__', page.bgGradient)
    .replaceAll('__ACCENT_BAR__', page.accentBar)
    .replaceAll('__TITLE__', escHtml(page.title))
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__PILLS__', page.pillHtml)
    .replaceAll('__PATH__', escHtml(page.path));
}

function fillDayTemplate(tpl, page) {
  return tpl
    .replaceAll('__TITLE__', escHtml(page.title))
    .replaceAll('__SUBTITLE__', escHtml(page.subtitle))
    .replaceAll('__PILLS__', page.pillHtml)
    .replaceAll('__PATH__', escHtml(page.path));
}

function signatureFor(page, templateHash) {
  const h = createHash('sha256');
  // Hash the fields that actually affect the rendered PNG; keep the URL out
  // so identical content under a renamed slug would still cache-hit (it
  // won't happen in practice, but principle: PNG content depends on visual
  // fields only).
  let payload;
  if (page.kind === 'station') {
    payload = {
      kind: 'station',
      name: page.stationName,
      pills: page.linePills,
      sub: page.subtitle,
    };
  } else if (page.kind === 'calendar') {
    payload = { kind: 'calendar', sub: page.subtitle, grid: page.gridHtml };
  } else if (page.kind === 'stats') {
    payload = { kind: 'stats', sub: page.subtitle, stats: page.statsHtml };
  } else if (page.kind === 'compare') {
    // Static template — content is fully baked in. The template hash
    // (mixed in below) is the only thing that can change the PNG.
    payload = { kind: 'compare' };
  } else if (page.kind === 'day') {
    payload = { kind: 'day', title: page.title, sub: page.subtitle, pills: page.pillHtml };
  } else if (page.kind === 'system') {
    payload = {
      kind: 'system',
      mode: page.mode,
      title: page.title,
      sub: page.subtitle,
      pills: page.pillHtml,
      bg: page.bgGradient,
      bar: page.accentBar,
    };
  } else {
    payload = {
      kind: page.kind,
      label: page.label,
      title: page.title ?? '',
      accent: page.accent,
      sub: page.subtitle,
      active: !!page.active,
    };
  }
  h.update(JSON.stringify({ ...payload, templateHash }));
  return h.digest('hex');
}

async function renderPng(page, html, outPath) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({
    path: outPath,
    type: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
}

async function workerPool(items, size, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!existsSync(DATA)) {
    console.warn(`prerender-pages: ${DATA} missing — skipping`);
    return;
  }
  const payload = normalizeAlertsPayload(JSON.parse(readFileSync(DATA, 'utf8')));
  // daily-counts.json is optional — if it's missing (e.g. during a build
  // before the cron has dropped one in), skip the calendar OG card rather
  // than failing the whole step.
  const dailyPayload = existsSync(DAILY_DATA) ? JSON.parse(readFileSync(DAILY_DATA, 'utf8')) : null;
  const shell = readFileSync(SHELL, 'utf8');
  const lineTpl = readFileSync(LINE_TPL, 'utf8');
  const stationTpl = readFileSync(STATION_TPL, 'utf8');
  const calendarTpl = existsSync(CALENDAR_TPL) ? readFileSync(CALENDAR_TPL, 'utf8') : null;
  const statsTpl = existsSync(STATS_TPL) ? readFileSync(STATS_TPL, 'utf8') : null;
  const compareTpl = existsSync(COMPARE_TPL) ? readFileSync(COMPARE_TPL, 'utf8') : null;
  // DAY_TPL is required (ships in the repo). Treat like LINE_TPL/STATION_TPL.
  const dayTpl = readFileSync(DAY_TPL, 'utf8');
  const systemTpl = readFileSync(SYSTEM_TPL, 'utf8');
  const lineHash = createHash('sha256').update(lineTpl).digest('hex').slice(0, 16);
  const stationHash = createHash('sha256').update(stationTpl).digest('hex').slice(0, 16);
  const calendarHash = calendarTpl
    ? createHash('sha256').update(calendarTpl).digest('hex').slice(0, 16)
    : '';
  const statsHash = statsTpl
    ? createHash('sha256').update(statsTpl).digest('hex').slice(0, 16)
    : '';
  const compareHash = compareTpl
    ? createHash('sha256').update(compareTpl).digest('hex').slice(0, 16)
    : '';
  const dayHash = createHash('sha256').update(dayTpl).digest('hex').slice(0, 16);
  const systemHash = createHash('sha256').update(systemTpl).digest('hex').slice(0, 16);

  const pages = planPages(payload, dailyPayload);
  if (pages.length === 0) {
    console.log('prerender-pages: nothing to render');
    return;
  }

  mkdirSync(CACHE, { recursive: true });

  const renders = [];
  const seenSlugs = new Set();
  for (const page of pages) {
    seenSlugs.add(page.slug);
    let tplHash;
    if (page.kind === 'station') tplHash = stationHash;
    else if (page.kind === 'calendar') tplHash = calendarHash;
    else if (page.kind === 'stats') tplHash = statsHash;
    else if (page.kind === 'compare') tplHash = compareHash;
    else if (page.kind === 'day') tplHash = dayHash;
    else if (page.kind === 'system') tplHash = systemHash;
    else tplHash = lineHash;
    const sig = signatureFor(page, tplHash);

    mkdirSync(page.outDir, { recursive: true });
    writeFileSync(resolve(page.outDir, 'index.html'), buildHtmlStub(shell, page));

    const cacheDir = resolve(CACHE, page.slug);
    const cachedPng = resolve(cacheDir, 'og.png');
    const cachedSig = resolve(cacheDir, 'sig');
    const sigMatches =
      existsSync(cachedPng) && existsSync(cachedSig) && readFileSync(cachedSig, 'utf8') === sig;

    if (sigMatches) {
      copyFileSync(cachedPng, resolve(page.outDir, 'og.png'));
      continue;
    }

    let html;
    if (page.kind === 'station') html = fillStationTemplate(stationTpl, page);
    else if (page.kind === 'calendar') html = fillCalendarTemplate(calendarTpl, page);
    else if (page.kind === 'stats') html = fillStatsTemplate(statsTpl, page);
    else if (page.kind === 'compare') html = fillCompareTemplate(compareTpl);
    else if (page.kind === 'day') html = fillDayTemplate(dayTpl, page);
    else if (page.kind === 'system') html = fillSystemTemplate(systemTpl, page);
    else html = fillLineTemplate(lineTpl, page);
    renders.push({ page, html, cacheDir, cachedPng, cachedSig, sig });
  }

  let rendered = 0;
  const cached = pages.length - renders.length;

  if (renders.length > 0) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    const playwrightPages = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, renders.length) }, () => ctx.newPage()),
    );
    let i = 0;
    await workerPool(renders, playwrightPages.length, async (item) => {
      const pw = playwrightPages[i++ % playwrightPages.length];
      const out = resolve(item.page.outDir, 'og.png');
      await renderPng(pw, item.html, out);
      mkdirSync(item.cacheDir, { recursive: true });
      copyFileSync(out, item.cachedPng);
      writeFileSync(item.cachedSig, item.sig);
      rendered++;
    });
    await browser.close();
  }

  // Sweep stale cache entries (e.g. a bus route or station that aged out of
  // the 90-day window since the last build).
  let pruned = 0;
  for (const entry of readdirSync(CACHE)) {
    if (!seenSlugs.has(entry)) {
      rmSync(resolve(CACHE, entry), { recursive: true, force: true });
      pruned++;
    }
  }

  console.log(
    `prerender-pages: ${rendered} rendered, ${cached} cache-hit, ${pruned} pruned (concurrency=${CONCURRENCY})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
