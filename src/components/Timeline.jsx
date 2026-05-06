import { useMemo, useRef, useEffect } from 'react';
import { TRAIN_LINES, TRAIN_LINE_ORDER } from '../lib/ctaLines.js';
import { buildIncidentsByDay, hexToRgba } from '../lib/dataUtils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Cell background color based on incident count.
function cellBg(count, lineColor) {
  if (count === 0) return 'var(--timeline-empty)';
  if (count === 1) return hexToRgba(lineColor, 0.4);
  return lineColor;
}

const NO_DATA_STYLE = {
  backgroundImage: 'repeating-linear-gradient(-45deg, var(--no-data-stripe1) 0px, var(--no-data-stripe1) 1px, var(--no-data-stripe2) 1px, var(--no-data-stripe2) 4px)',
};

export default function Timeline({ alerts, observations, selectedLines, numDays, dataStartTs, onLineClick }) {
  const now = useMemo(() => Date.now(), []);
  const scrollRef = useRef(null);

  // Scroll to the right (today) on mount and whenever numDays changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [numDays]);

  const incidentsByDay = useMemo(
    () => buildIncidentsByDay(alerts, observations, numDays, now),
    [alerts, observations, numDays, now],
  );

  // col 0 = oldest day, col numDays-1 = today
  const days = useMemo(
    () =>
      Array.from({ length: numDays }, (_, col) => {
        const dayIdx = numDays - 1 - col;
        const date = new Date(now - dayIdx * DAY_MS);
        return { col, dayIdx, date };
      }),
    [numDays, now],
  );

  const linesToShow =
    selectedLines !== null && selectedLines.length > 0
      ? TRAIN_LINE_ORDER.filter((l) => selectedLines.includes(l))
      : selectedLines !== null && selectedLines.length === 0
        ? []
        : TRAIN_LINE_ORDER;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        {numDays}-Day Timeline
      </h2>
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        <div ref={scrollRef} className="overflow-x-auto pb-4">
          <table className="border-collapse">
            <thead>
              <tr>
                {/* Corner spacer — matches the width of line label cells */}
                <th className="sticky left-0 bg-white dark:bg-gh-surface z-10 w-16 min-w-[4rem]" />
                {/* Month label: only render text on the 1st of each month */}
                {days.map(({ col, date }) => (
                  <th
                    key={col}
                    className="p-0 pr-px pb-1 align-bottom text-left"
                    style={{ width: 11 }}
                  >
                    {date.getDate() === 1 && (
                      <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap" style={{ fontSize: 10 }}>
                        {date.toLocaleString('en-US', { month: 'short' })}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linesToShow.map((lineKey) => {
                const info = TRAIN_LINES[lineKey];
                const incidents = incidentsByDay[lineKey] || {};
                return (
                  <tr key={lineKey}>
                    {/* Line label — sticky so it stays visible while scrolling horizontally */}
                    <td className="sticky left-0 bg-white dark:bg-gh-surface z-10 pr-3 align-middle min-w-[4rem]">
                      <button
                        onClick={() => onLineClick(lineKey)}
                        className="text-xs font-semibold w-full text-right hover:opacity-70 transition-opacity"
                        style={{ color: info.color }}
                      >
                        {info.label}
                      </button>
                    </td>
                    {/* One cell per day */}
                    {days.map(({ col, dayIdx, date }) => {
                      // A cell is "no data" only if its entire window predates the data start.
                      // Using dayEnd (the recent edge of the window) avoids hiding a cell that
                      // has real data later in the same day (e.g. the Yellow Line alert on Apr 26
                      // started at 8pm but the rolling window for that dayIdx opens at noon).
                      const dayEnd = now - dayIdx * DAY_MS;
                      const noData = dataStartTs != null && dayEnd <= dataStartTs;
                      const count = incidents[dayIdx] || 0;
                      const label = noData
                        ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: no data`
                        : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${count} incident${count !== 1 ? 's' : ''}`;
                      return (
                        <td key={col} className="p-0 pr-px pb-px">
                          <div
                            title={label}
                            className="w-2.5 h-2.5 rounded-sm"
                            style={noData ? NO_DATA_STYLE : { backgroundColor: cellBg(count, info.color) }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100 dark:border-gh-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500">Less</span>
            <div className="flex gap-0.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--timeline-empty)' }} />
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: hexToRgba('#64748b', 0.4) }}
              />
              <div className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500">More</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={NO_DATA_STYLE} />
            <span className="text-xs text-slate-400 dark:text-slate-500">No data</span>
          </div>
          <span className="text-xs text-slate-300 dark:text-slate-600">· Click a line name to filter</span>
        </div>
      </div>
    </section>
  );
}
