// Metra is launched: the SPA shows `kind: 'metra'` incidents to every visitor.
// The only remaining split is the Node build/prerender scripts (feed, sitemap,
// CSV, prerendered OG pages) — those stay CTA-only until their generators learn
// Metra (OG cards, per-line feeds, maps are still deferred). They run in Node,
// where `window` is undefined, so the default below keeps their output CTA-only
// while the browser gets the full payload.
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
