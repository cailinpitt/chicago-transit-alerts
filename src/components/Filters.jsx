import { TRAIN_LINES, TRAIN_LINE_ORDER } from '../lib/ctaLines.js';

const DATE_OPTIONS = [
  { label: '30d', value: 30 },
  { label: '60d', value: 60 },
  { label: '90d', value: 90 },
  { label: 'All', value: null },
];

export default function Filters({ selectedLines, onLinesChange, showBus, onShowBusChange, dateRange, onDateRangeChange }) {
  const toggleLine = (line) => {
    onLinesChange((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line],
    );
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Line filter */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          onClick={() => onLinesChange([])}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            selectedLines.length === 0
              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
          }`}
        >
          All lines
        </button>
        {TRAIN_LINE_ORDER.map((key) => {
          const info = TRAIN_LINES[key];
          const active = selectedLines.includes(key);
          const dimmed = selectedLines.length > 0 && !active;
          return (
            <button
              key={key}
              onClick={() => toggleLine(key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                dimmed ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500' : ''
              }`}
              style={dimmed ? {} : { backgroundColor: info.color, color: info.textColor }}
            >
              {info.label}
            </button>
          );
        })}
      </div>

      <div className="hidden sm:block w-px h-4 bg-slate-200 dark:bg-slate-600" />

      {/* Bus toggle */}
      <button
        onClick={() => onShowBusChange((prev) => !prev)}
        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
          showBus
            ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
        }`}
      >
        Bus
      </button>

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
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
