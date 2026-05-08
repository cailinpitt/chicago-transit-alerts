import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';

// Each pill is a link to the relevant /line/:id or /route/:id page. Brand
// colors stay loud, so we lean on subtle hover affordance (cursor + slight
// dim) rather than a competing visual cue. Multi-route alerts render one
// pill per route, each with its own destination.
const PILL_BASE =
  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity';

export default function LinePill({ kind, line, routes }) {
  const keys = routes?.length > 0 ? routes : [line];
  return (
    <>
      {keys.map((key) => {
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
        return (
          <a
            key={key}
            href={kind === 'bus' ? `/route/${key}` : '/'}
            className={`${PILL_BASE} bg-slate-700 text-white`}
          >
            {kind === 'bus' ? formatBusRoute(key) : key}
          </a>
        );
      })}
    </>
  );
}
