import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import TrendSparkline from './TrendSparkline.jsx';

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
      {alerts && observations && <TrendSparkline alerts={alerts} observations={observations} />}
    </div>
  );
}
