import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { metraLineInfo, normalizeMetraLine } from '../lib/metraLines.js';

// Each pill is a link to the relevant /line/:id or /route/:id page. Brand
// colors stay loud, so we lean on subtle hover affordance (cursor + slight
// dim) rather than a competing visual cue. Multi-route alerts render one
// pill per route, each with its own destination.
const PILL_BASE =
  'inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity';

export default function LinePill({ kind, line, routes }) {
  const keys = routes?.length > 0 ? routes : [line];
  return (
    <>
      {keys.map((key) => {
        if (kind === 'metra') {
          // Metra lines aren't called "X Line" (it's "BNSF", "Metra Electric"),
          // so the brand-colored pill shows the label as-is.
          const info = metraLineInfo(key);
          if (info) {
            return (
              <a
                key={key}
                href={`/metra/line/${normalizeMetraLine(key)}`}
                className={PILL_BASE}
                style={{ backgroundColor: info.color, color: info.textColor }}
              >
                {info.label}
              </a>
            );
          }
          // Agency-wide Metra alert with no resolvable line (routes: []) — render
          // a neutral "Metra" pill rather than an empty chip.
          return (
            <span
              key={key ?? 'metra'}
              className={PILL_BASE.replace('cursor-pointer hover:opacity-80', '')}
              style={{ backgroundColor: '#64748b', color: '#fff' }}
            >
              Metra
            </span>
          );
        }
        const info = kind === 'train' ? TRAIN_LINES[key] : null;
        if (info) {
          return (
            <a
              key={key}
              href={`/line/${key}`}
              className={PILL_BASE}
              style={{ backgroundColor: info.color, color: info.textColor }}
            >
              {info.label} Line
            </a>
          );
        }
        const busLabel = kind === 'bus' ? formatBusRoute(key) : key;
        return (
          <a
            key={key}
            href={kind === 'bus' ? `/route/${key}` : '/'}
            // max-w-full + an inner truncate keeps a long route name (e.g.
            // #10 "Obama Presidential Center/Museum of Science & Industry")
            // on one line, ellipsizing instead of wrapping into a ragged
            // two-line pill when the container is narrow. The pill still
            // shows its full width when there's room; the title carries the
            // complete name for the truncated case.
            className={`${PILL_BASE} bg-slate-700 text-white max-w-full`}
            title={kind === 'bus' ? busLabel : undefined}
          >
            <span className="min-w-0 truncate">{busLabel}</span>
          </a>
        );
      })}
    </>
  );
}
