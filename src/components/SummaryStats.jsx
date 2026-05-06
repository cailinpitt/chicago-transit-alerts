import { TRAIN_LINES } from '../lib/ctaLines.js';

function Sep() {
  return <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>;
}

export default function SummaryStats({ activeCount, weeklyCount, mostAffectedKind, mostAffectedId }) {
  const parts = [];

  if (activeCount > 0) {
    parts.push(
      <span key="active">
        <strong className="text-slate-800 dark:text-slate-100">{activeCount}</strong>{' '}
        active now
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
      <strong className="text-slate-800 dark:text-slate-100">{weeklyCount}</strong>{' '}
      incident{weeklyCount === 1 ? '' : 's'} in the last 7 days
    </span>,
  );

  if (mostAffectedKind === 'train' && TRAIN_LINES[mostAffectedId]) {
    const info = TRAIN_LINES[mostAffectedId];
    parts.push(
      <span key="affected">
        <strong style={{ color: info.color }}>{info.label} Line</strong> most affected (last 30 days)
      </span>,
    );
  } else if (mostAffectedKind === 'bus') {
    parts.push(
      <span key="affected">
        <strong className="text-slate-800 dark:text-slate-100">Route {mostAffectedId}</strong>{' '}
        most affected (last 30 days)
      </span>,
    );
  }

  return (
    <p className="text-sm text-slate-600 dark:text-slate-300 px-1">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <Sep />}
          {p}
        </span>
      ))}
    </p>
  );
}
