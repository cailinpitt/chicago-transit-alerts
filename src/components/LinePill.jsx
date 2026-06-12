import { formatBusRoute } from '../lib/busRoutes.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { metraLineInfo, normalizeMetraLine } from '../lib/metraLines.js';

// Each pill is a link to the relevant /line/:id or /route/:id page. Brand
// colors stay loud, so we lean on subtle hover affordance (cursor + slight
// dim) rather than a competing visual cue. Multi-route alerts render one
// pill per route, each with its own destination.
const PILL_BASE =
  'inline-flex items-center min-h-[24px] px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity';

export default function LinePill({ kind, line, routes, linked = true }) {
  const keys = routes?.length > 0 ? routes : [line];
  const chipClass = linked ? PILL_BASE : PILL_BASE.replace('cursor-pointer hover:opacity-80', '');
  const renderChip = (key, href, className, children, props = {}) =>
    linked ? (
      <a key={key} href={href} className={className} {...props}>
        {children}
      </a>
    ) : (
      <span key={key} className={className} {...props}>
        {children}
      </span>
    );
  return (
    <>
      {keys.map((key) => {
        if (kind === 'metra') {
          // Metra lines aren't called "X Line" (it's "BNSF", "Metra Electric"),
          // so the brand-colored pill shows the label as-is.
          const info = metraLineInfo(key);
          if (info) {
            return renderChip(
              key,
              `/metra/line/${normalizeMetraLine(key)}`,
              chipClass,
              info.label,
              { style: { backgroundColor: info.color, color: info.textColor } },
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
          return renderChip(key, `/line/${key}`, chipClass, `${info.label} Line`, {
            style: { backgroundColor: info.color, color: info.textColor },
          });
        }
        const busLabel = kind === 'bus' ? formatBusRoute(key) : key;
        return renderChip(
          key,
          kind === 'bus' ? `/route/${key}` : '/',
          `${chipClass} bg-slate-700 text-white max-w-full`,
          <span className="min-w-0 truncate">{busLabel}</span>,
          { title: kind === 'bus' ? busLabel : undefined },
        );
      })}
    </>
  );
}
