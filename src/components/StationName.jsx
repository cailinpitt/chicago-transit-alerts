import { displayStationName, isKnownStationSlug, slugifyStation } from '../lib/stations.js';
import HighlightedText from './HighlightedText.jsx';

// Render a station name. Becomes a link to /station/:slug whenever the
// slug resolves to a known roster station — even if there are no recent
// incidents in the window, the page itself is still a useful destination
// (it shows the line pills and a "no recent activity" state). Falls back
// to plain text only when the slug doesn't match the roster at all.
// When `searchQuery` is non-empty, matched substrings get wrapped in <mark>.
export default function StationName({ name, stationIndex: _stationIndex, searchQuery = '' }) {
  if (!name) return null;
  const slug = slugifyStation(name);
  // Display drops the "(Purple)"-style qualifier — line context is already
  // visible elsewhere on every render site that uses this component.
  // Slug still derives from the full name so /station/central-purple stays
  // distinct from /station/central-green.
  const display = displayStationName(name);
  const inner = <HighlightedText text={display} query={searchQuery} />;
  if (slug && isKnownStationSlug(slug)) {
    // Dotted underline as a "this text is interactive" cue without going as
    // loud as full blue-link styling — these names appear inline inside
    // descriptive sentences (e.g. "Howard → Loyola"), so a subtle always-on
    // affordance reads better than nothing-until-hover. Solidifies + turns
    // blue on hover to confirm it's a link.
    return (
      <a
        href={`/station/${slug}`}
        className="underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-[3px] hover:decoration-solid hover:decoration-blue-500 hover:text-blue-500"
      >
        {inner}
      </a>
    );
  }
  return <>{inner}</>;
}
