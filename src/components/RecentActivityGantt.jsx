import { useMemo } from 'react';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import {
  formatRoutesLabel,
  getEventId,
  mergeMatchingIncidents,
} from '../lib/incidents.js';

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const BUS_COLOR = '#64748b';

// How many bars to render before truncating. A truly bad day can produce 60+
// incidents in 24h; rendering all of them collapses the strip into a brown
// smear. Show the most recent N + a tail count.
const MAX_BARS = 30;

// 24-hour incident ribbon. Each row is one merged incident drawn as a bar on
// a shared time axis (now - 24h → now). Complement to the per-line 90-day
// timeline — that one shows day-level counts per line; this one shows
// individual incidents across the system, hour-scale, so co-occurrence
// reads at a glance.
//
// Hidden when the last 24 hours had fewer than 3 incidents. A single bar
// has nothing to compare against, and a quiet day's strip is just noise.
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

    // Most recent at the bottom so the eye reads the strip top→bottom as
    // time advances. Truncate before sort so we keep the freshest bars
    // when there's a deluge.
    relevant.sort((a, b) => a.startTs - b.startTs);
    const truncated = relevant.slice(-MAX_BARS);
    const hiddenCount = relevant.length - truncated.length;

    return { items: truncated, totalCount: relevant.length, hiddenCount };
  }, [alerts, observations, now]);

  if (!data || data.totalCount < 3) return null;

  const windowStart = now - WINDOW_MS;

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 px-1">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Last 24 hours
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {data.totalCount} incident{data.totalCount === 1 ? '' : 's'}
          {data.hiddenCount > 0 && ` · showing ${MAX_BARS} most recent`}
        </span>
      </div>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="space-y-[3px]">
          {data.items.map((i) => {
            const startClamped = Math.max(i.startTs, windowStart);
            const endClamped = Math.min(i.endTs ?? now, now);
            const leftPct = ((startClamped - windowStart) / WINDOW_MS) * 100;
            const widthPct = Math.max(((endClamped - startClamped) / WINDOW_MS) * 100, 0.5);
            const isTrain = i.kind === 'train';
            const color = isTrain ? (TRAIN_LINES[i.line]?.color ?? BUS_COLOR) : BUS_COLOR;
            const routeLabel = formatRoutesLabel(i.kind, i.routes);
            const headlineLabel =
              i.headline ?? (i.from && i.to ? `${i.from} → ${i.to}` : 'Service disruption');
            const tooltip = `${routeLabel}: ${headlineLabel}${i.active ? ' · ongoing' : ''}`;
            // Track is a passive background; only the colored bar itself
            // is interactive. Earlier version wrapped the whole row in an
            // <a>, which made empty time-of-day space navigate to that row's
            // event — clicking 8am on a 6pm incident shouldn't take you to
            // the 6pm incident.
            const barStyle = {
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              backgroundColor: color,
              opacity: i.active ? 1 : 0.7,
            };
            return (
              <div
                key={i.eventId ? `${i.eventId}-${i.startTs}` : `${i.startTs}-${i.line ?? 'none'}`}
                role="img"
                aria-label={tooltip}
                className="relative h-2.5 rounded-sm bg-slate-100 dark:bg-gh-subtle"
              >
                {i.eventId ? (
                  <a
                    href={`/event/${i.eventId}`}
                    title={tooltip}
                    className="absolute top-0 bottom-0 rounded-sm hover:opacity-80 transition-opacity"
                    style={barStyle}
                  >
                    <span className="sr-only">{tooltip}</span>
                  </a>
                ) : (
                  <div
                    title={tooltip}
                    className="absolute top-0 bottom-0 rounded-sm"
                    style={barStyle}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-2">
          <span>24h ago</span>
          <span>12h ago</span>
          <span>now</span>
        </div>
      </div>
    </section>
  );
}
