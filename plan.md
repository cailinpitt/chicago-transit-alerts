# cta-alert-history — plan

## 1. Atom feed bug

### Investigation findings

- Live feed (`https://chicagotransitalerts.app/feed.xml`) is structurally valid Atom (`xmllint --noout` passes).
- Served with `content-type: application/xml`, `cache-control: max-age=600`.
- Regenerating on every deploy — currently 46 entries with the newest from this morning.
- Cron + GitHub Actions pipeline is healthy; `feed.xml` is being rewritten.

Conclusion: not a generation bug. Most likely **reader compatibility** issue.

### Reader: Inoreader

Inoreader-specific behavior:

- Dedupes on `<id>` first, but falls back to **title + summary similarity** when `<content>` is absent. Many entries have nearly identical summaries (`"Temporary Reroute"`, `"Service disruption detected"`) — likely tripping the fallback dedup.
- Uses `<updated>` to surface "entry changed", but only re-marks unread when the **body content** also differs. Resolved entries bump `<updated>` but `<summary>` doesn't change, so the re-surface-on-resolution behavior the README advertises probably isn't actually working in Inoreader.

### Recommended fix (Inoreader-targeted)

1. **Add `<content type="text">` per entry, richer than `<summary>`.** Include route label, segment (`from → to`), evidence chip text, and state. Gives Inoreader unique-enough content to not dedupe.
2. **On resolution, materially change the body.** Prefix `"[Resolved] "` or append resolution time/duration so the re-surface actually triggers.
3. **Skip per-entry `<author>` for now** — not the cause for Inoreader.

Code shape:

```js
// in generate-feed.js, expand entrySummary/entryContent:
function entryBody(incident) {
  const parts = [];
  if (incident.resolved_ts) {
    const dur = formatDuration(incident.resolved_ts - startTs(incident));
    parts.push(`[Resolved after ${dur}]`);
  } else if (incident.active) {
    parts.push('[Ongoing]');
  }
  if (incident.headline) parts.push(incident.headline);
  const seg = [incident.from_station, incident.to_station].filter(Boolean).join(' → ');
  if (seg) parts.push(seg);
  const chip = formatEvidenceChip(incident);
  if (chip) parts.push(chip);
  // …
  return parts.join(' · ');
}
```

Then emit both `<summary>` and `<content type="text">` with this richer text.

---

## 2. Discoverability + filter→list distance

The bigger issue surfaced from the picker idea: the filter bar is at the top of the homepage but the IncidentList is at the bottom, after three visualizations. Picking a filter and verifying its effect on the list requires a long scroll. Adding a Lines & routes card would worsen this — so address the underlying layout first.

### Proposal

**a) Reorder the homepage** so the list directly follows filtering:

Old: Active → Filters → Summary → Timeline → Hour grid → Signal mix → List
New: Active → Filters → Summary → **List** → Timeline → Hour grid → Signal mix

Rationale: the IncidentList is the data; Timeline/Hour grid/Signal mix are pattern overlays. After the change, picking a filter immediately shows matching incidents; visualizations sit below as aggregate context.

**b) Make the filter bar sticky** (`position: sticky; top: 0`) with a backdrop and subtle border so it reads as floating. Loop becomes: adjust filter (visible) → see list update directly below.

Mobile: filter row wraps to ~80–110px when sticky. Acceptable for first pass; can later add a collapsed-chip variant when scrolled (`Red Line · 30d · 2 signals · Edit ▾`).

**c) Header browse dropdown.** Once layout is fixed, the picker doesn't need a new homepage card. A `<details>`-style dropdown in the Header, visible from every page (`/`, `/event/:id`, `/line/:id`, `/station/:slug`), is the better surface — especially for deep-link visitors landing on `/event/...` who currently can't navigate anywhere but `/`.

Contents:
- **Train pills** (always all 8) linking to `/line/<id>` — brand colors.
- **Bus routes with data in the 90-day window**, sorted by total incidents desc, capped at ~15.
- **Top stations** (top ~10 by incident count) from `buildStationIndex`.

Secondary surface: a small "Browse all routes →" link in the Timeline footer for users already engaging with that section.

### Implementation order

1. Reorder the JSX in `App.jsx`.
2. Wrap `Filters` in a sticky container with bg + border.
3. New `BrowseMenu` component reusing `buildStationIndex` and a small per-route counter; plumb data into `Header` from each page that fetches.
4. (Optional) Timeline footer link.
5. (Deferred) Mobile collapsed-chip filter variant.

---

## 3. Additional feature ideas

Filtered to things that serve the mission — "see when and where the CTA breaks, with shareable URLs" — and don't duplicate what's already built.

### High value, low effort

1. **`/calendar` page** — 12×31 calendar grid of the last 12 months, color-keyed by daily incident count. Complements the 90-day timeline; surfaces seasonality (winter cold-stretch spikes). Data already in `buildIncidentsByDay`-style aggregations.

2. **Longest incident-free streak per line on `LinePage`.** Currently only the homepage shows `quietestLineId`; per-line pages only show current streak. Add a "longest 90d streak" stat. Bragging-rights numbers travel well on social.

3. **`/stats` "worst" leaderboards.** Worst single day in window, worst rush hour, worst station, longest single incident. Trivially derivable from existing aggregations.

4. **Auto-generated "what broke today" summary** at top of homepage. Single deterministic sentence, no LLM: "3 incidents on Red, 2 on Blue, 1 ongoing on the 66 — busiest day this week." Augments `SummaryStats`.

5. **Compare mode: `/compare?lines=red,blue`.** Side-by-side timelines, hour-of-week heatmaps, and reliability stats. Useful for journalism ("Red vs Blue Q1 2026").

### Medium effort, distinctive

6. **Schema.org JSON-LD on event pages.** `Event` or `CivicStructure` schema with `startDate`, `endDate`, `location` (when stations are present). Adds rich-result eligibility in Google + makes data discoverable to crawlers. Small block in `prerender-events.js`.

7. **CSV / NDJSON export.** `alerts.json` is great but pandas users want flat CSV. Second postbuild script writing `dist/data/incidents.csv` expands the research/journalism audience the README names.

8. **Resolution-time histograms per signal type per line.** `computeTypicalDurations` already powers the "typically clears in ~Xm" hint; surface the underlying distribution as a small histogram on each `LinePage`. Directly answers "how long should I expect this kind of disruption to last?"

9. **Per-line OG card refresh on active state.** Right now OG is built at deploy time, looks the same active or quiet. A small `og-active.png` variant when a line has an active incident makes shared links contextual.

### Higher effort, mission-aligned

10. **Per-station heatmap on a stylized line map (per train line).** SVG of the L with stations color-keyed by 90-day incident frequency. The headline visualization the project is missing; most-shared screenshot it'll ever produce. Stations data already exists.

11. **Year-over-year and week-over-week deltas baked in.** "Red Line is 23% worse this April than last April." Requires ≥365 days of data; `data_start_ts` implies you have more than 90d — start computing against it.

12. **Email digest signup.** Atom is great for power users but most riders won't install Inoreader. Weekly email ("here's what broke last week on the lines you care about") via Buttondown/Listmonk, no backend needed.

### Quality-of-life

13. **Mobile timeline UX.** 90-day grid horizontal-scrolls but no swipe affordance. Subtle gradient fade on right edge + drag-to-scroll hint.

14. **Persist signal/line selections across visits** via sessionStorage, separately from URL state. URL state preserves filters within a tab today; not across visits.

15. **`prefers-reduced-motion` respect.** Pulsing dot and `animate-fade-highlight` animate unconditionally.

16. **Sitemap for events.** Verify `dist/sitemap.xml` includes `/event/:id`. If not, search engines aren't indexing per-event detail pages — directly hurts the "shareable, link-worthy" mission.

---

## 4. Minor bug

(TBD — to be added)
