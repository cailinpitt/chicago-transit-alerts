// Display helpers for schedule-anchored single-train Metra cancellations.
//
// The cta-insights pipeline ships a `cancellation` object on an incident's `cta`
// block when a Metra alert annuls exactly one scheduled train (see export-web.js).
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

/**
 * Normalize an incident's cancellation block, or null when it isn't a
 * single-train cancellation.
 * @param {object} incident
 * @returns {{state:string,isUpcoming:boolean,isCancelled:boolean,departureTs:number|null,arrivalTs:number|null,trainNumber:string|null,origin:string|null}|null}
 */
export function cancellationInfo(incident) {
  const c = incident?.cta?.cancellation;
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
