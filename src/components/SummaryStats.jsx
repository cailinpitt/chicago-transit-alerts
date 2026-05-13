import { useMemo } from 'react';
import { buildDailyTrend, computeDisruptionMinutes } from '../lib/aggregate.js';
import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { formatMinutesAsHours } from '../lib/format.js';
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

// One sentence-group worth of inline stat phrases, joined by `·`. The outer
// element is plain block flow (not flex) — flex containers strip whitespace
// between children, which would eat the space after `<strong>` tags inside
// each phrase. Phrases still wrap naturally on narrow viewports because the
// container is a normal paragraph.
function StatRow({ children }) {
  const items = children.filter(Boolean);
  if (items.length === 0) return null;
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are stable phrases per render
        <span key={i}>
          {i > 0 && <Sep />}
          {item}
        </span>
      ))}
    </p>
  );
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

  // System-wide disruption-hours over the last 7 days, sized to match the
  // existing "X incidents in the last 7 days" phrase. Line-hours, summed
  // across all 8 train lines (buses excluded — bus routes outnumber lines
  // 100:1 and would warp the denominator without a meaningful baseline).
  const disruption7d = useMemo(() => {
    if (!alerts || !observations) return null;
    return computeDisruptionMinutes(
      alerts.filter((a) => a.kind === 'train'),
      observations.filter((o) => o.kind === 'train'),
      {
        windowDays: 7,
        lines: TRAIN_LINE_ORDER.map((line) => ({ kind: 'train', line })),
      },
    );
  }, [alerts, observations]);

  const activePhrase =
    activeCount > 0 ? (
      <>
        <strong className="text-slate-800 dark:text-slate-100">{activeCount}</strong> active now
      </>
    ) : (
      <span className="text-slate-500 dark:text-slate-400">All clear</span>
    );

  const weekPhrase = (
    <>
      <strong className="text-slate-800 dark:text-slate-100">{weeklyCount}</strong> incident
      {weeklyCount === 1 ? '' : 's'} in the last 7 days
    </>
  );

  // Total severity over the same 7 days. Hidden when there's nothing to
  // report — a flat-zero week shouldn't drag a third phrase onto the line.
  const disruptionPhrase =
    disruption7d && disruption7d.disruptedMinutes > 0 ? (
      <span title="Total line-time across all train lines spent in a detected disruption over the last 7 days. Assumes 21h/day of scheduled service per line.">
        <strong className="text-slate-800 dark:text-slate-100">
          {formatMinutesAsHours(disruption7d.disruptedMinutes)}
        </strong>{' '}
        of disrupted train-line time
      </span>
    ) : null;

  let affectedPhrase = null;
  if (mostAffectedKind === 'train' && TRAIN_LINES[mostAffectedId]) {
    const info = TRAIN_LINES[mostAffectedId];
    affectedPhrase = (
      <>
        <strong style={{ color: info.color }}>{info.label} Line</strong> most affected (last 30
        days)
      </>
    );
  } else if (mostAffectedKind === 'bus') {
    affectedPhrase = (
      <>
        <strong className="text-slate-800 dark:text-slate-100">
          {formatBusRoute(mostAffectedId)}
        </strong>{' '}
        most affected (last 30 days)
      </>
    );
  }

  // WoW callout. Gated so a 1→2 weekend doesn't read as "100% busier".
  let trendPhrase = null;
  if (trend?.trendRatio != null) {
    const priorTotal = trend.prior7Avg * 7;
    const delta = trend.trendRatio - 1;
    if (Math.abs(delta) >= CALLOUT_DELTA && priorTotal >= CALLOUT_MIN_PRIOR) {
      const pct = Math.round(Math.abs(delta) * 100);
      const up = delta > 0;
      trendPhrase = (
        <>
          <strong className={up ? 'text-red-500' : 'text-green-600 dark:text-green-500'}>
            {pct}% {up ? 'busier' : 'quieter'}
          </strong>{' '}
          than the prior 7 days
        </>
      );
    }
  }

  // Quietest streak: positive callout, surfaced only when the streak is
  // long enough to be interesting. <2 days clears that bar most of the time.
  let quietestPhrase = null;
  if (quietestLineId && TRAIN_LINES[quietestLineId] && quietestLineDays >= 2) {
    const info = TRAIN_LINES[quietestLineId];
    quietestPhrase = (
      <>
        <strong style={{ color: info.color }}>{info.label} Line</strong> quietest:{' '}
        {quietestLineDays} days since last incident
      </>
    );
  }

  // Three logical groups stacked vertically:
  //   1. State + volume — "6 active · 46 incidents in the last 7 days"
  //   2. Trend phrase + sparkline (only when we have a callout)
  //   3. Rankings — "#66 Chicago most affected · Yellow Line quietest"
  // Each group is flex-wrap so on narrow widths individual phrases break
  // onto their own lines instead of one long run-on. The sparkline lives
  // beside the trend phrase rather than at the far right of the whole
  // block, so the visual reads "this number is what the line shows".
  return (
    <div className="space-y-1.5 px-1">
      <StatRow>{[activePhrase, weekPhrase, disruptionPhrase]}</StatRow>
      {alerts && observations && (trendPhrase || trend?.trendRatio != null) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
          {trendPhrase ?? <span className="text-slate-500 dark:text-slate-400">Trend</span>}
          <TrendSparkline alerts={alerts} observations={observations} trend={trend} />
        </div>
      )}
      <StatRow>{[affectedPhrase, quietestPhrase]}</StatRow>
    </div>
  );
}
