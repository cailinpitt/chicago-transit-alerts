import { useMemo } from 'react';
import { buildDailyTrend } from '../lib/aggregate.js';
import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import TrendSparkline from './TrendSparkline.jsx';

// Callout threshold: only surface a "X% busier/quieter than the prior week"
// sentence when both the relative change is large (≥25%) and the prior-week
// baseline had real volume (≥3 incidents). Without the volume floor a 1→2
// swing reads as a 100% jump — technically true, narratively meaningless.
const CALLOUT_DELTA = 0.25;
const CALLOUT_MIN_PRIOR = 3;

function Sep() {
  return <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>;
}

export default function SummaryStats({
  activeCount,
  weeklyCount,
  mostAffectedKind,
  mostAffectedId,
  quietestLineId,
  quietestLineDays,
  alerts,
  observations,
}) {
  const trend = useMemo(
    () => (alerts && observations ? buildDailyTrend(alerts, observations) : null),
    [alerts, observations],
  );

  const parts = [];

  if (activeCount > 0) {
    parts.push(
      <span key="active">
        <strong className="text-slate-800 dark:text-slate-100">{activeCount}</strong> active now
      </span>,
    );
  } else {
    parts.push(
      <span key="active" className="text-slate-500 dark:text-slate-400">
        All clear
      </span>,
    );
  }

  parts.push(
    <span key="week">
      <strong className="text-slate-800 dark:text-slate-100">{weeklyCount}</strong> incident
      {weeklyCount === 1 ? '' : 's'} in the last 7 days
    </span>,
  );

  if (mostAffectedKind === 'train' && TRAIN_LINES[mostAffectedId]) {
    const info = TRAIN_LINES[mostAffectedId];
    parts.push(
      <span key="affected">
        <strong style={{ color: info.color }}>{info.label} Line</strong> most affected (last 30
        days)
      </span>,
    );
  } else if (mostAffectedKind === 'bus') {
    parts.push(
      <span key="affected">
        <strong className="text-slate-800 dark:text-slate-100">
          {formatBusRoute(mostAffectedId)}
        </strong>{' '}
        most affected (last 30 days)
      </span>,
    );
  }

  // Week-over-week callout: louder than the trend chip on the sparkline,
  // gated so it only fires on weeks worth pointing at.
  if (trend?.trendRatio != null) {
    const priorTotal = trend.prior7Avg * 7;
    const delta = trend.trendRatio - 1;
    if (Math.abs(delta) >= CALLOUT_DELTA && priorTotal >= CALLOUT_MIN_PRIOR) {
      const pct = Math.round(Math.abs(delta) * 100);
      const up = delta > 0;
      parts.push(
        <span key="trend-callout">
          <strong className={up ? 'text-red-500' : 'text-green-600 dark:text-green-500'}>
            {pct}% {up ? 'busier' : 'quieter'}
          </strong>{' '}
          than the prior 7 days
        </span>,
      );
    }
  }

  // Quietest streak: a positive callout, surfaced only when the streak is
  // long enough to be interesting. <2 days is just "didn't break today" —
  // every line clears that bar most of the time, so showing it would dilute
  // the more useful sentences.
  if (quietestLineId && TRAIN_LINES[quietestLineId] && quietestLineDays >= 2) {
    const info = TRAIN_LINES[quietestLineId];
    parts.push(
      <span key="quietest">
        <strong style={{ color: info.color }}>{info.label} Line</strong> quietest:{' '}
        {quietestLineDays} days since last incident
      </span>,
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1">
      <p className="text-sm text-slate-600 dark:text-slate-300 min-w-0">
        {parts.map((p, i) => (
          <span key={p.key}>
            {i > 0 && <Sep />}
            {p}
          </span>
        ))}
      </p>
      {alerts && observations && (
        <TrendSparkline alerts={alerts} observations={observations} trend={trend} />
      )}
    </div>
  );
}
