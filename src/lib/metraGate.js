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

/** Is `?metra=1` literally present in the URL? Used for URL-param stickiness. */
export function metraParamPresent() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(METRA_PARAM) === '1';
  } catch {
    return false;
  }
}

/**
 * Is the Metra preview enabled for this view? Always on in local dev (so you
 * don't have to type `?metra=1`); on prod it requires the param.
 * `import.meta.env.DEV` is true only under `vite dev`. In the Node build/prerender
 * scripts `import.meta.env` is undefined, so this falls through to the param check
 * (where `window` is undefined → false) and the build outputs stay CTA-only.
 */
export function metraEnabled() {
  if (import.meta.env?.DEV) return true;
  return metraParamPresent();
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
