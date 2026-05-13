import { useMemo } from 'react';
import { TRAIN_LINES, TRAIN_LINE_ORDER } from '../lib/ctaLines.js';
import { formatRoutesLabel, getEventId, mergeMatchingIncidents } from '../lib/incidents.js';

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const BUS_COLOR = '#64748b';
const BUS_ROW_KEY = '__bus__';

// 24-hour incident strip. One fixed row per CTA train line plus a Bus row,
// drawn against a shared time axis (now - 24h → now). A multi-line incident
// renders a bar on every affected line's row, so you can read "Green's day"
// at a glance even when Green shared an incident with Red earlier.
//
// Hidden when the last 24 hours had fewer than 3 incidents — a quiet day's
// strip of mostly-empty tracks is just noise.
export default function RecentActivityGantt({ alerts, observations, now }) {
  const data = useMemo(() => {
    const windowStart = now - WINDOW_MS;
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(
      alerts ?? [],
      observations ?? [],
    );
    const all = [
      ...merged.map((m) => ({
        kind: m.kind,
        routes: m.routes ?? [],
        line: m.routes?.[0] ?? null,
        startTs: m.first_seen_ts,
        endTs: m.resolved_ts ?? null,
        active: m.active,
        headline: m.headline,
        from: m.from_station,
        to: m.to_station,
        eventId: getEventId(m),
      })),
      ...standaloneAlerts.map((a) => ({
        kind: a.kind,
        routes: a.routes ?? [],
        line: a.routes?.[0] ?? null,
        startTs: a.first_seen_ts,
        endTs: a.resolved_ts ?? null,
        active: a.active,
        headline: a.headline,
        from: a.affected_from_station,
        to: a.affected_to_station,
        eventId: getEventId(a),
      })),
      ...standaloneObs.map((o) => ({
        kind: o.kind,
        routes: o.line ? [o.line] : [],
        line: o.line,
        startTs: o.first_seen_ts ?? o.ts,
        endTs: o.resolved_ts ?? null,
        active: o.active,
        headline: null,
        from: o.from_station,
        to: o.to_station,
        eventId: getEventId(o),
      })),
    ];

    // Keep incidents that overlap the window: either started inside it OR
    // are still active (extends to now). A 6-day planned reroute won't
    // dominate the strip because we clamp the bar to the window below.
    const relevant = all.filter((i) => {
      if (i.startTs == null) return false;
      const end = i.endTs ?? now;
      return end >= windowStart && i.startTs <= now;
    });

    relevant.sort((a, b) => a.startTs - b.startTs);

    // Bucket each incident into every line-row it affects. Train incidents
    // with no routes (rare, but possible from upstream) get dropped here —
    // they have no row to land on. Bus incidents go on a single Bus row.
    const rows = new Map();
    for (const key of TRAIN_LINE_ORDER) rows.set(key, []);
    rows.set(BUS_ROW_KEY, []);

    for (const i of relevant) {
      if (i.kind === 'train') {
        const routes = (i.routes ?? []).filter((r) => rows.has(r));
        for (const r of routes) rows.get(r).push(i);
      } else {
        rows.get(BUS_ROW_KEY).push(i);
      }
    }

    return { rows, totalCount: relevant.length };
  }, [alerts, observations, now]);

  if (!data || data.totalCount < 3) return null;

  const windowStart = now - WINDOW_MS;
  const rowDefs = [
    ...TRAIN_LINE_ORDER.map((key) => ({
      key,
      label: TRAIN_LINES[key].label,
      color: TRAIN_LINES[key].color,
    })),
    { key: BUS_ROW_KEY, label: 'Bus', color: BUS_COLOR },
  ].filter(({ key }) => (data.rows.get(key) ?? []).length > 0);

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 px-1">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Last 24 hours
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {data.totalCount} incident{data.totalCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="space-y-[3px]">
          {rowDefs.map(({ key, label, color }) => {
            const items = data.rows.get(key) ?? [];
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {label}
                </span>
                <div className="relative flex-1 h-2.5 rounded-sm bg-slate-100 dark:bg-gh-subtle">
                  {items.map((i) => {
                    const startClamped = Math.max(i.startTs, windowStart);
                    const endClamped = Math.min(i.endTs ?? now, now);
                    const leftPct = ((startClamped - windowStart) / WINDOW_MS) * 100;
                    const widthPct = Math.max(
                      ((endClamped - startClamped) / WINDOW_MS) * 100,
                      0.5,
                    );
                    const routeLabel = formatRoutesLabel(i.kind, i.routes);
                    const headlineLabel =
                      i.headline ?? (i.from && i.to ? `${i.from} → ${i.to}` : 'Service disruption');
                    const tooltip = `${routeLabel}: ${headlineLabel}${i.active ? ' · ongoing' : ''}`;
                    const barStyle = {
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      opacity: i.active ? 1 : 0.7,
                    };
                    const barKey = i.eventId
                      ? `${i.eventId}-${i.startTs}`
                      : `${i.startTs}-${key}`;
                    return i.eventId ? (
                      <a
                        key={barKey}
                        href={`/event/${i.eventId}`}
                        title={tooltip}
                        aria-label={tooltip}
                        className="absolute top-0 bottom-0 rounded-sm hover:opacity-80 transition-opacity"
                        style={barStyle}
                      >
                        <span className="sr-only">{tooltip}</span>
                      </a>
                    ) : (
                      <div
                        key={barKey}
                        title={tooltip}
                        aria-label={tooltip}
                        className="absolute top-0 bottom-0 rounded-sm"
                        style={barStyle}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-2 pl-14">
          <span>24h ago</span>
          <span>12h ago</span>
          <span>now</span>
        </div>
      </div>
    </section>
  );
}
