import { slugifyStation } from '../lib/stations.js';

// Below this threshold a station's page would be near-empty and the link
// would be more annoying than useful — leave the name as plain text.
export const STATION_LINK_MIN_COUNT = 2;

// Render a station name. Becomes a link to /station/:slug when the station
// has enough incidents in the index to make the page worth visiting; falls
// back to plain text otherwise. Always plain text when no index is passed
// (e.g. tests rendering a host component directly).
export default function StationName({ name, stationIndex }) {
  if (!name) return null;
  const slug = slugifyStation(name);
  const rec = slug && stationIndex ? stationIndex.get(slug) : null;
  if (rec && rec.count >= STATION_LINK_MIN_COUNT) {
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
        {name}
      </a>
    );
  }
  return <>{name}</>;
}
