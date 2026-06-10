// Metra is gated behind a `?metra=1` query param while it's pre-launch. By
// default the frontend filters `kind: 'metra'` incidents out entirely, so the
// live CTA site is unaffected even though Metra data ships inside alerts.json.
// Adding `?metra=1` reveals the Metra data + UI. The param is sticky across
// filter changes (App re-appends it when mirroring state to the URL).
//
// SSR-safe: with no `window` (the Node build/prerender scripts), Metra is treated
// as disabled, so prerendered pages, the feed, the sitemap, and the CSV are all
// CTA-only too — nothing Metra is published in a discoverable form pre-launch.

export const METRA_PARAM = 'metra';

/** Is the Metra preview enabled for this view? (`?metra=1`) */
export function metraEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(METRA_PARAM) === '1';
  } catch {
    return false;
  }
}

/**
 * Drop `kind: 'metra'` incidents unless Metra is enabled. The single chokepoint —
 * apply it where the payload is loaded so no downstream view sees Metra by default.
 * @param {Array} incidents
 * @param {boolean} [showMetra]
 */
export function gateIncidents(incidents, showMetra = metraEnabled()) {
  if (showMetra) return incidents || [];
  return (incidents || []).filter((inc) => inc.kind !== 'metra');
}
