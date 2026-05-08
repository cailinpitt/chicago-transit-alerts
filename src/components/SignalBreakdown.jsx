import { useMemo } from 'react';
import { buildSignalsByLine } from '../lib/aggregate.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { SIGNAL_LABELS, SIGNAL_TYPES } from '../lib/incidents.js';

// Distinct, accessible colors for each signal category. Tied to the
// disruption "feel" — gap/ghost (absence) sit cool, bunching (excess) sits
// warm, pulse subtypes sit muted to read as a related family.
const SIGNAL_COLORS = {
  gap: '#0ea5e9', // sky-500
  bunching: '#f97316', // orange-500
  ghost: '#6366f1', // indigo-500
  'pulse-cold': '#94a3b8', // slate-400
  'pulse-held': '#64748b', // slate-500
};

function lineTotal(counts) {
  return SIGNAL_TYPES.reduce((sum, sig) => sum + (counts[sig] || 0), 0);
}

export default function SignalBreakdown({ observations }) {
  const { byLine, totals } = useMemo(() => buildSignalsByLine(observations), [observations]);

  // Skip lines with no observations entirely — keeps the chart focused on
  // lines that actually have a signal mix to break down.
  const linesWithData = TRAIN_LINE_ORDER.filter((line) => lineTotal(byLine[line]) > 0);
  const grandTotal = SIGNAL_TYPES.reduce((s, sig) => s + (totals[sig] || 0), 0);
  if (grandTotal === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        Signal mix by line
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="space-y-2">
          {linesWithData.map((line) => {
            const info = TRAIN_LINES[line];
            const counts = byLine[line];
            const total = lineTotal(counts);
            return (
              <div key={line} className="flex items-center gap-3">
                <div className="w-12 flex-shrink-0 text-right">
                  <span className="text-xs font-semibold" style={{ color: info.color }}>
                    {info.label}
                  </span>
                </div>
                <div
                  className="flex-1 flex h-4 rounded-sm overflow-hidden bg-slate-100 dark:bg-gh-subtle"
                  role="img"
                  aria-label={`${info.label} Line: ${SIGNAL_TYPES.map(
                    (s) => `${counts[s]} ${SIGNAL_LABELS[s]}`,
                  )
                    .filter((part) => !part.startsWith('0 '))
                    .join(', ')}`}
                >
                  {SIGNAL_TYPES.map((sig) => {
                    const c = counts[sig];
                    if (c === 0) return null;
                    const pct = (c / total) * 100;
                    return (
                      <div
                        key={sig}
                        title={`${SIGNAL_LABELS[sig]}: ${c} (${Math.round(pct)}%)`}
                        style={{ width: `${pct}%`, backgroundColor: SIGNAL_COLORS[sig] }}
                      />
                    );
                  })}
                </div>
                <div className="w-10 text-right flex-shrink-0">
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {total}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 pt-3 border-t border-slate-100 dark:border-gh-border">
          {SIGNAL_TYPES.map((sig) => (
            <div key={sig} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: SIGNAL_COLORS[sig] }}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {SIGNAL_LABELS[sig]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
