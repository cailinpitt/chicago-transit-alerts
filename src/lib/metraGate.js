// Metra is launched: the SPA shows `kind: 'metra'` incidents to every visitor,
// the CSV + global feed + per-line Metra feeds include them, and Metra line/event
// pages render geographic maps. The remaining Node-side split is the prerendered
// OG **card images** (event/sitemap OG pages), which aren't Metra-aware yet — so
// those generators rely on the Node default below (`window` is undefined in Node
// → CTA-only), while the browser and the Metra-aware generators (feed/CSV) pass
// `showMetra: true`.
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
