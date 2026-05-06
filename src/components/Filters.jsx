import { useRef, useState, useEffect } from 'react';
import { TRAIN_LINES, TRAIN_LINE_ORDER } from '../lib/ctaLines.js';

const DATE_OPTIONS = [
  { label: '30d', value: 30 },
  { label: '60d', value: 60 },
  { label: '90d', value: 90 },
  { label: 'All', value: null },
];

function BusRoutePopover({ availableBusRoutes, selectedBusRoutes, onBusRoutesChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleRoute = (route) => {
    onBusRoutesChange((prev) =>
      prev.includes(route) ? prev.filter((r) => r !== route) : [...prev, route],
    );
  };

  const selectedCount = selectedBusRoutes.length;
  const label = selectedCount > 0 ? `Routes (${selectedCount})` : 'Routes';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors flex items-center gap-1 ${
          selectedCount > 0
            ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
            : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
        }`}
      >
        {label}
        <span className="opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-20 bg-white dark:bg-gh-surface border border-slate-200 dark:border-gh-border rounded-lg shadow-lg p-3 min-w-[160px]">
          <div className="flex flex-wrap gap-1.5">
            {selectedCount > 0 && (
              <button
                onClick={() => onBusRoutesChange([])}
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 hover:opacity-80 transition-opacity"
              >
                All routes
              </button>
            )}
            {availableBusRoutes.map((route) => {
              const active = selectedBusRoutes.includes(route);
              return (
                <button
                  key={route}
                  onClick={() => toggleRoute(route)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
                      : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
                  }`}
                >
                  #{route}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Filters({ selectedLines, onLinesChange, showBus, onShowBusChange, availableBusRoutes, selectedBusRoutes, onBusRoutesChange, dateRange, onDateRangeChange }) {
  const toggleLine = (line) => {
    onLinesChange((prev) => {
      if (prev === null) return [line];
      return prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line];
    });
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Line filter */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          onClick={() =>
            onLinesChange(selectedLines !== null && selectedLines.length === 0 ? null : [])
          }
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            selectedLines === null || selectedLines.length > 0
              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
              : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
          }`}
        >
          Trains
        </button>
        {TRAIN_LINE_ORDER.map((key) => {
          const info = TRAIN_LINES[key];
          const active = selectedLines !== null && selectedLines.includes(key);
          const dimmed = selectedLines !== null && !active;
          return (
            <button
              key={key}
              onClick={() => toggleLine(key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                dimmed ? 'bg-slate-200 dark:bg-gh-subtle text-slate-400 dark:text-slate-500' : ''
              }`}
              style={dimmed ? {} : { backgroundColor: info.color, color: info.textColor }}
            >
              {info.label}
            </button>
          );
        })}
      </div>

      <div className="hidden sm:block w-px h-4 bg-slate-200 dark:bg-slate-600" />

      {/* Bus toggle + route popover */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onShowBusChange(!showBus)}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            showBus
              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
              : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
          }`}
        >
          Buses
        </button>
        {showBus && availableBusRoutes.length > 0 && (
          <BusRoutePopover
            availableBusRoutes={availableBusRoutes}
            selectedBusRoutes={selectedBusRoutes}
            onBusRoutesChange={onBusRoutesChange}
          />
        )}
      </div>

      <div className="hidden sm:block w-px h-4 bg-slate-200 dark:bg-slate-600" />

      {/* Date range filter */}
      <div className="flex gap-1">
        {DATE_OPTIONS.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => onDateRangeChange(value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              dateRange === value
                ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
                : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
