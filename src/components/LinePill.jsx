import { formatBusRoute } from '../lib/busRoutes.js';
import { normalizeTrainLine, TRAIN_LINES } from '../lib/ctaLines.js';
import { metraLineInfo, normalizeMetraLine } from '../lib/metraLines.js';

// Each pill is a link to the relevant /line/:id or /route/:id page. Brand
// colors stay loud, so we lean on subtle hover affordance (cursor + slight
// dim) rather than a competing visual cue. Multi-route alerts render one
// pill per route, each with its own destination.
const PILL_BASE =
  'inline-flex items-center min-w-0 max-w-full min-h-[24px] px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity';
// Tighter chip for dense lists (e.g. the accessibility outage rows), where a
// transfer station's three full "X Line" pills crowd the row.
const PILL_COMPACT =
  'inline-flex items-center min-w-0 max-w-full min-h-[18px] px-1.5 py-px rounded-full text-[11px] font-semibold leading-none cursor-pointer hover:opacity-80 transition-opacity';

export default function LinePill({ kind, line, routes, linked = true, compact = false }) {
  const keys = routes?.length > 0 ? routes : [line];
  const base = compact ? PILL_COMPACT : PILL_BASE;
  const chipClass = linked ? base : base.replace('cursor-pointer hover:opacity-80', '');
  // Every pill caps at its container width and truncates its label — a long
  // route name (e.g. "#114 Columbia Dr / Snapfinger Woods Dr" or "Milwaukee
  // District West") otherwise blows the compact row's width and pushes the
  // elapsed-time chip off a phone screen.
  const renderChip = (key, href, className, label, props = {}) =>
    linked ? (
      <a key={key} href={href} className={className} title={label} {...props}>
        <span className="min-w-0 truncate">{label}</span>
      </a>
    ) : (
      <span key={key} className={className} title={label} {...props}>
        <span className="min-w-0 truncate">{label}</span>
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
        const trainKey = kind === 'train' ? normalizeTrainLine(key) : key;
        const info = kind === 'train' ? TRAIN_LINES[trainKey] : null;
        if (info) {
          return renderChip(
            key,
            `/line/${trainKey}`,
            chipClass,
            compact ? info.label : `${info.label} Line`,
            { style: { backgroundColor: info.color, color: info.textColor } },
          );
        }
        const busLabel = kind === 'bus' ? formatBusRoute(key) : key;
        return renderChip(
          key,
          kind === 'bus' ? `/route/${key}` : '/',
          `${chipClass} bg-slate-700 text-white`,
          busLabel,
        );
      })}
    </>
  );
}
