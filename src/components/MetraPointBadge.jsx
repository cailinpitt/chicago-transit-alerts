import { metraPointEventLabel } from '../lib/incidents.js';

// Status badge for a Metra point event (delay / cancellation / inferred). The
// label comes from metraPointEventLabel; the tone follows the existing
// convention — a confirmed cancellation reads as a settled fact (slate, like the
// timetable cancellation badge), while late and unconfirmed stay amber
// (caution). Renders nothing for an unknown kind. Used by the incident list,
// the event page, and the surrounding-incidents context rows so the three stay
// in sync.
export default function MetraPointBadge({ source }) {
  const label = metraPointEventLabel(source);
  if (!label) return null;
  const amber = source !== 'cancellation';
  return (
    <span
      className={`text-xs font-semibold ${
        amber ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      {label}
    </span>
  );
}
