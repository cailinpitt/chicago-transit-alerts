import { useMemo } from 'react';
import { buildDailyTrend, computeDisruptionMinutes } from '../lib/aggregate.js';
import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { formatMinutesAsHours } from '../lib/format.js';
import { METRA_LINE_ORDER } from '../lib/metraLines.js';
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
  // Homepage hides the active-now figure because the Active Now / All-clear
  // status header right above already states it — repeating it here is noise.
  // Other pages (line, system) keep it since they have no such header.
  showActive = true,
  agency = 'all',
}) {
  const trend = useMemo(
    () => (alerts && observations ? buildDailyTrend(alerts, observations) : null),
    [alerts, observations],
  );

  // System-wide disruption-hours over the last 7 days, sized to match the
  // existing "X incidents in the last 7 days" phrase. Line-hours are summed
  // across each agency's rail lines, keeping CTA and Metra visually distinct.
  const ctaDisruption7d = useMemo(() => {
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

  const metraDisruption7d = useMemo(() => {
    if (!alerts || !observations) return null;
    return computeDisruptionMinutes(
      alerts.filter((a) => a.kind === 'metra'),
      observations.filter((o) => o.kind === 'metra'),
      {
        windowDays: 7,
        lines: METRA_LINE_ORDER.map((line) => ({ kind: 'metra', line })),
      },
    );
  }, [alerts, observations]);

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

  // Headline numbers as stat cards — a 2x2 grid on mobile and a horizontal
  // strip on desktop. Big-number cards are scannable at a glance, where the
  // old desktop "·"-joined phrase line read as a wall of bold words. The
  // trend card is mobile-only; desktop keeps the trend as a phrase beside its
  // sparkline (below the card strip), which the card can't hold.
  const activeCard = (
    <StatCard
      value={activeCount > 0 ? activeCount : '0'}
      label={activeCount > 0 ? 'active now' : 'all clear'}
    />
  );
  const weekCard = <StatCard value={weeklyCount} label="in last 7 days" />;
  const buildDisruptionCard = (disruption, label, title) => {
    if (!disruption || disruption.disruptedMinutes <= 0) return null;
    const pct = disruption.ratio * 100;
    const pctLabel = pct < 1 ? '<1%' : `~${Math.round(pct)}%`;
    return (
      <StatCard
        value={formatMinutesAsHours(disruption.disruptedMinutes, { maxUnit: 'hours' })}
        label={`${label} trains disrupted in last 7 days · ${pctLabel} of the time`}
        title={title}
      />
    );
  };
  const ctaDisruptionCard =
    agency !== 'metra'
      ? buildDisruptionCard(
          ctaDisruption7d,
          'CTA',
          'Total CTA train line-hours in a detected disruption over the last 7 days, summed across the 8 lines (overlapping detections on one line are unioned; separate lines are summed). The percentage is that share of scheduled CTA train service hours.',
        )
      : null;
  const metraDisruptionCard =
    agency !== 'cta'
      ? buildDisruptionCard(
          metraDisruption7d,
          'Metra',
          'Total Metra line-hours in a detected disruption over the last 7 days, summed across the 11 lines (overlapping detections on one line are unioned; separate lines are summed). The percentage is that share of estimated Metra service hours.',
        )
      : null;
  const trendCard = (() => {
    if (trend?.trendRatio == null) return null;
    const priorTotal = trend.prior7Avg * 7;
    const delta = trend.trendRatio - 1;
    if (Math.abs(delta) < CALLOUT_DELTA || priorTotal < CALLOUT_MIN_PRIOR) return null;
    const pct = Math.round(Math.abs(delta) * 100);
    const up = delta > 0;
    return (
      <StatCard
        value={
          <span className={up ? 'text-red-500' : 'text-green-600 dark:text-green-500'}>
            {up ? '↗' : '↘'} {pct}%
          </span>
        }
        label="vs prior 7d"
      />
    );
  })();
  const mobileCards = [
    showActive ? activeCard : null,
    weekCard,
    ctaDisruptionCard,
    metraDisruptionCard,
    trendCard,
  ].filter(Boolean);
  // Desktop strip omits the trend card (rendered as a phrase + sparkline row
  // below) and, like mobile, drops the active card when the host page already
  // shows an active/all-clear status above.
  const desktopCards = [
    showActive ? activeCard : null,
    weekCard,
    ctaDisruptionCard,
    metraDisruptionCard,
  ].filter(Boolean);

  // Two layouts share data but diverge structurally:
  //   - Mobile (<sm): 2x2 grid of stat cards, then the affected/quietest
  //     sentences.
  //   - Desktop (sm+): horizontal stat-card strip, then the trend phrase +
  //     sparkline row, then the affected/quietest sentences.
  return (
    <div className="px-1">
      {/* Mobile */}
      <div className="sm:hidden">
        {mobileCards.length > 0 && (
          // auto-rows-fr equalizes every row's height so a card with a longer
          // label (e.g. the disruption card) doesn't make its row taller than
          // the others; h-full lets each card fill its cell.
          <div className="grid grid-cols-2 auto-rows-fr gap-2 mb-4">
            {mobileCards.map((card, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are stable per render
              <div key={i} className="h-full">
                {card}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1">
          {affectedPhrase && (
            <p className="text-sm text-slate-600 dark:text-slate-300">{affectedPhrase}</p>
          )}
          {quietestPhrase && (
            <p className="text-sm text-slate-600 dark:text-slate-300">{quietestPhrase}</p>
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden sm:block space-y-3">
        {desktopCards.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {desktopCards.map((card, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are stable per render
              <div key={i} className="flex-1 min-w-[8rem]">
                {card}
              </div>
            ))}
          </div>
        )}
        {alerts && observations && (trendPhrase || trend?.trendRatio != null) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            {trendPhrase ?? <span className="text-slate-500 dark:text-slate-400">Trend</span>}
            <TrendSparkline alerts={alerts} observations={observations} trend={trend} />
          </div>
        )}
        <StatRow>{[affectedPhrase, quietestPhrase]}</StatRow>
      </div>
    </div>
  );
}

// Compact card used in the mobile grid. Big number, small label — the
// number is the thing the eye should land on. `value` accepts a node so
// the trend card can color/icon-prefix the figure without a custom card.
function StatCard({ value, label, title }) {
  return (
    <div
      className="h-full rounded-md border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface px-3 py-2"
      title={title}
    >
      <div className="text-lg font-semibold leading-tight text-slate-800 dark:text-slate-100 tabular-nums">
        {value}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}
