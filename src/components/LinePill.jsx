import { TRAIN_LINES } from '../lib/ctaLines.js';

export default function LinePill({ kind, line, routes }) {
  const keys = routes?.length > 0 ? routes : [line];
  return (
    <>
      {keys.map((key) => {
        const info = kind === 'train' ? TRAIN_LINES[key] : null;
        if (info) {
          return (
            <span
              key={key}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: info.color, color: info.textColor }}
            >
              {info.label} Line
            </span>
          );
        }
        return (
          <span
            key={key}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700 text-white"
          >
            {kind === 'bus' ? `Route ${key}` : key}
          </span>
        );
      })}
    </>
  );
}
