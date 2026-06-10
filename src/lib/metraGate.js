// Metra is launched and threaded through nearly every surface: the SPA, the CSV,
// the global + per-line feeds, geographic maps, and prerendered OG cards +
// sitemap entries for Metra line/station/event/system pages. The Node default
// below (`window` undefined → CTA-only) now serves a narrower purpose: the
// prerender/sitemap scripts gate the *CTA payload* so their CTA-scoped loops
// (day aggregates, the CTA `/station/` namespace, CTA event selection) stay
// CTA-only, and handle Metra separately from an un-gated `metraFlat`. The
// browser and the fully Metra-aware generators (feed/CSV, prerender-events) pass
// `showMetra: true` to opt the whole payload in.
//
// Historical note: this used to be a `?metra=1` query-param gate that hid Metra
// from the live site pre-launch. The param was dropped at launch; the function
// now only guards the not-yet-Metra-aware build outputs.

/**
 * Drop `kind: 'metra'` incidents unless Metra is shown. Defaults to "shown" in
 * the browser (launched) and "hidden" in Node (CTA-only build outputs). Apply it
 * at the payload-load boundary so the split happens in exactly one place.
 * @param {Array} incidents
 * @param {boolean} [showMetra] defaults to true in the browser, false in Node
 */
export function gateIncidents(incidents, showMetra = typeof window !== 'undefined') {
  if (showMetra) return incidents || [];
  return (incidents || []).filter((inc) => inc.kind !== 'metra');
}
