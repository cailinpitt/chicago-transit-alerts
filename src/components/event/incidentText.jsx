import { botSummaryText, isMetraPointSource, splitObservations } from '../../lib/incidents.js';
import { displayStationName } from '../../lib/stations.js';
import StationName from '../StationName.jsx';

// Pull the routes/line out of an incident in a uniform shape. Alerts/merged
// records carry plural `routes`; standalone observations carry singular `line`.
export function incidentRoutes(incident) {
  if (Array.isArray(incident?.routes) && incident.routes.length > 0) return incident.routes;
  if (incident?.line) return [incident.line];
  return [];
}

// Plain-string variant of `describe` for places that can't render JSX —
// document.title, plain text logging, etc.
export function describeText(incident) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  // Metra point event: lead with the pre-rendered sentence ("~57 min late — …",
  // "Scheduled train not seen running — …") so the title reads as a delay /
  // cancellation, not a route.
  if (isMetraPointSource(primary?.detection_source) && primary?.bot_description) {
    return primary.bot_description;
  }
  if (primary?.from_station && primary?.to_station) {
    const seg = `${displayStationName(primary.from_station)} → ${displayStationName(primary.to_station)}`;
    return primary.direction_label ? `${seg} (${primary.direction_label})` : seg;
  }
  return botSummaryText(incident);
}

export function describe(incident, stationIndex) {
  if (incident.cta) return incident.cta.headline;
  const { primary } = splitObservations(incident);
  // Metra point event: the pre-rendered sentence is the title (see describeText).
  if (isMetraPointSource(primary?.detection_source) && primary?.bot_description) {
    return primary.bot_description;
  }
  if (primary?.from_station && primary?.to_station) {
    return (
      <>
        <StationName name={primary.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={primary.to_station} stationIndex={stationIndex} />
        {primary.direction_label && (
          <span className="ml-2 text-base font-normal text-slate-500 dark:text-slate-400">
            ({primary.direction_label})
          </span>
        )}
      </>
    );
  }
  return botSummaryText(incident);
}
