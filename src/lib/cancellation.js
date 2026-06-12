// Display helpers for schedule-anchored single-train Metra cancellations.
//
// The cta-insights pipeline ships a top-level `cancellation` object on an incident
// when a Metra alert annuls exactly one scheduled train (see export-web.js). It's
// an incident-level fact, not alert metadata — deliberately NOT under the `cta`
// block, whose name is a CTA-era misnomer for the official-alert slot.
// It carries the rider-facing label and the train's timetable, computed upstream —
// so the frontend stays a dumb renderer: no clock math, no "is it past?" logic
// here. We just read `state` and the scheduled times and present them.
//
// Lifecycle (set server-side):
//   'upcoming'  — announced, before the train's scheduled departure
//   'cancelled' — the scheduled departure has passed; terminal
//
// Open-ended notices ("no UP-N service due to police activity") carry no
// cancellation object and keep the ordinary ongoing→resolved status.

import { formatTime } from './format.js';
import { officialAlert } from './incidents.js';

/**
 * Normalize an incident's cancellation block, or null when it isn't a
 * single-train cancellation.
 * @param {object} incident
 * @returns {{state:string,isUpcoming:boolean,isCancelled:boolean,departureTs:number|null,arrivalTs:number|null,trainNumber:string|null,origin:string|null}|null}
 */
export function cancellationInfo(incident) {
  const c = incident?.status?.type === 'cancellation' ? incident.status : null;
  if (!c?.state) return null;
  return {
    state: c.state,
    isUpcoming: c.state === 'upcoming',
    isCancelled: c.state === 'cancelled',
    departureTs: c.scheduled_departure_ts ?? null,
    arrivalTs: c.scheduled_arrival_ts ?? null,
    trainNumber: c.train_number ?? null,
    origin: c.origin ?? null,
  };
}

/** Short status-pill label, e.g. 'upcoming cancellation' / 'cancelled'. */
export function cancellationStatusLabel(info) {
  if (!info) return null;
  return info.isUpcoming ? 'upcoming cancellation' : 'cancelled';
}

/**
 * The upcoming (announced-but-not-yet-departed) single-train cancellations in a
 * set of incidents, soonest first. Filtered to departures still ahead of `now`
 * (an 'upcoming' whose time has passed is finalizing server-side; don't surface
 * it as still-upcoming). Each entry is flattened for direct rendering.
 * @returns {Array<{id:string,line:string|null,trainNumber:string|null,departureTs:number,origin:string|null,headline:string|null}>}
 */
export function collectUpcomingCancellations(incidents, { now = Date.now() } = {}) {
  const out = [];
  for (const inc of incidents || []) {
    const info = cancellationInfo(inc);
    if (!info?.isUpcoming || info.departureTs == null || info.departureTs <= now) continue;
    out.push({
      id: inc.id,
      line: Array.isArray(inc.routes) ? (inc.routes[0] ?? null) : null,
      trainNumber: info.trainNumber,
      departureTs: info.departureTs,
      origin: info.origin,
      headline: officialAlert(inc)?.headline ?? null,
    });
  }
  return out.sort((a, b) => a.departureTs - b.departureTs);
}

/**
 * Rider-facing scheduled-time phrase for the cancelled train, e.g.
 * "8:40 PM → 10:08 PM" (full run) or "8:40 PM departure" (departure only).
 * Null when no scheduled times are known.
 */
export function cancellationSchedulePhrase(info) {
  if (!info || info.departureTs == null) return null;
  const dep = formatTime(info.departureTs);
  if (info.arrivalTs == null) return `${dep} departure`;
  return `${dep} → ${formatTime(info.arrivalTs)}`;
}
