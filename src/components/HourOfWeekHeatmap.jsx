import { Fragment, useMemo } from 'react';
import { buildHourOfWeek } from '../lib/aggregate.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Show every third hour as a column header so the 24-col grid stays legible
// without crowding. 0/3/6/.../21 mirrors how transit schedules pre-flag rush
// windows.
const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

// CSS grid template: a fixed-width label column on the left + 24 equal-width
// hour columns. `minmax(0, 1fr)` lets the cells shrink past their intrinsic
// width on narrow screens while still stretching to fill on desktop.
const GRID_TEMPLATE = 'auto repeat(24, minmax(0, 1fr))';

function formatHour(h) {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function cellBg(count, maxCount) {
  if (count === 0) return 'var(--timeline-empty)';
  // Five intensity stops keyed off the max, so the busiest cell is fully
  // saturated and the rest scale linearly. Single-incident cells get a faint
  // tint rather than disappearing.
  const ratio = count / maxCount;
  if (ratio < 0.2) return 'rgba(100, 116, 139, 0.25)';
  if (ratio < 0.4) return 'rgba(100, 116, 139, 0.45)';
  if (ratio < 0.7) return 'rgba(100, 116, 139, 0.65)';
  if (ratio < 0.9) return 'rgba(100, 116, 139, 0.85)';
  return 'rgb(71, 85, 105)';
}

export default function HourOfWeekHeatmap({ alerts, observations }) {
  const { grid, maxCount, total } = useMemo(
    () => buildHourOfWeek(alerts, observations),
    [alerts, observations],
  );

  if (total === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        When do incidents happen?
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div className="grid gap-1" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
          {/* Header row: empty corner cell + hour labels */}
          <div />
          {HOURS.map((h) => (
            <div key={h} className="pb-1 text-left">
              {HOUR_LABELS.includes(h) && (
                <span
                  className="text-slate-400 dark:text-slate-500 whitespace-nowrap"
                  style={{ fontSize: 10 }}
                >
                  {formatHour(h)}
                </span>
              )}
            </div>
          ))}

          {/* Day rows */}
          {DAYS.map((label, weekday) => (
            <Fragment key={label}>
              <div className="pr-2 flex items-center justify-end">
                <span
                  className="font-semibold text-slate-500 dark:text-slate-400"
                  style={{ fontSize: 11 }}
                >
                  {label}
                </span>
              </div>
              {HOURS.map((hour) => {
                const count = grid[weekday][hour];
                const tooltip = `${label} ${formatHour(hour)}: ${count} incident${
                  count === 1 ? '' : 's'
                }`;
                return (
                  <div
                    key={hour}
                    title={tooltip}
                    className="rounded-sm aspect-square"
                    style={{ backgroundColor: cellBg(count, maxCount) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-gh-border">
          <span className="text-xs text-slate-400 dark:text-slate-500">Less</span>
          <div className="flex gap-0.5">
            {[0, 0.1, 0.3, 0.55, 0.8, 1].map((r) => (
              <div
                key={r}
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor:
                    r === 0 ? 'var(--timeline-empty)' : cellBg(Math.ceil(r * maxCount), maxCount),
                }}
              />
            ))}
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">More</span>
          <span className="text-xs text-slate-300 dark:text-slate-600 ml-2">
            · Each cell = incidents starting in that hour
          </span>
        </div>
      </div>
    </section>
  );
}
