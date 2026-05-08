# CTA Alert History

A public archive of Chicago Transit Authority service alerts and bot-detected disruptions, with a GitHub-style heatmap of incident frequency over the last 90 days.

> **Unofficial project.** Not affiliated with, endorsed by, or sponsored by the Chicago Transit Authority.

**Live site:** https://chicagotransitalerts.app

![Timeline view: 90-day per-line heatmap of CTA incidents](docs/images/website-timeline.png)

![Incident list: chronological feed of recent alerts and bot observations](docs/images/website-incidents-list.png)

## What you see

- **Active alerts** — anything currently disrupting service, surfaced at the top of the page. New incidents picked up by the 5-minute poll briefly fade-in so returning visitors notice what's changed.
- **At-a-glance summary** — active count, last-7-days incident count, the most-affected line/route over 30 days, the train line with the longest clean streak, and a small 30-day trend sparkline (recent week vs. prior week).
- **90-day timeline** — a per-line contribution-style grid. Train rows + the top 5 most-affected bus routes + an aggregate "Other" row for the long tail. Click a day cell to drill into that single day; click a line name to open its dedicated page.
- **When do incidents happen?** — a 7×24 hour-of-week heatmap so you can see whether things really are worse at PM rush or on Sunday mornings.
- **Signal mix by line** — stacked bars showing the proportion of bot detection types (gap, bunching, ghost, cold stretch, trains held in place) per train line.
- **Incident history** — chronological day-grouped list of every captured alert and observation. Filterable by line, bus route, time window (7d / 30d / 90d / all), single pinned day, signal type, and free-text search across headlines, station names, route numbers, and route names ("Howard", "Chicago", "Red Line", "headway gaps", etc).
- **Per-event detail page** — every captured incident gets a permalink at `/event/:id` with surrounding-24h context on the same line and a 14-day mini timeline.

Filter state, the pinned day, and the search query all round-trip through the URL — any view is a shareable link.

## What's tracked

Two distinct sources, displayed together:

- **Official CTA alerts** — significant service alerts published by the CTA, captured via the CTA Alerts API and republished by the [@ctaalertinsights.bsky.social](https://bsky.app/profile/ctaalertinsights.bsky.social) Bluesky bot.
- **Bot-detected observations** — service disruptions inferred from live train and bus positions:
  - **Cold stretch** — no service through a segment for 15+ min (or 2.5× scheduled headway).
  - **Trains held in place** — multiple trains visibly stationary in a 1-mile cluster for 10+ min, with no other train moving through. Single-train holds where GPS goes silent are also caught via an inferred-held path inside the cold detector.
  - **Headway gap** — gap between consecutive vehicles materially longer than the scheduled headway.
  - **Bunching** — clusters of vehicles arriving stacked.
  - **Missing vehicles ("ghost")** — full hour where fewer vehicles ran than the schedule implies.
  - **Multi-signal roundup** — when several of the above fire on the same line at once.
  Posted by [@ctatraininsights](https://bsky.app/profile/ctatraininsights.bsky.social) and [@ctabusinsights](https://bsky.app/profile/ctabusinsights.bsky.social).

When an official alert and a bot observation describe the same incident on the same line within a couple of hours, they're merged into a single entry rather than double-counted. Each bot-detected observation also carries a small evidence payload ("3 trains held · 22 min stationary", "2 stations cold · 3 trains missed") shown as a chip on the incident — a one-line answer to "why does the bot think this happened?".

## Routes

Client-side routing only — every path renders the SPA from the same `index.html`. GitHub Pages's `404.html` (a copy of `index.html`) handles unknown paths so deep-links work without server-side rewriting.

| Path                    | What it shows                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `/`                     | Homepage with all the cards, filterable.                                               |
| `/event/:id`            | Single-incident detail page (id is the Bluesky post rkey).                             |
| `/line/:line`           | Train line page — `/line/red`, `/line/blue`, `/line/orange`, etc. CTA short codes (`org`, `p`, `g`, `brn`, `y`) also resolve correctly. |
| `/route/:routeId`       | Bus route page — `/route/66`, `/route/X9`, `/route/J14`, etc.                          |

## How it works

The site is a static React app — no backend, no database calls from the browser. All data lives in a single JSON file regenerated server-side and committed to this repo.

1. A cron job on a home server runs [`push-web-data.sh`](https://github.com/cailinpitt/cta-insights/blob/main/bin/push-web-data.sh) every 7 minutes.
2. The script exports the latest alert and observation data from the [cta-insights](https://github.com/cailinpitt/cta-insights) SQLite database to `public/data/alerts.json` and commits if anything changed.
3. GitHub Actions builds the Vite app and deploys it to GitHub Pages.
4. The browser polls `alerts.json` every 5 minutes so the page stays current without a reload.

## Stack

- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) for tests, [Biome](https://biomejs.dev/) for linting and formatting
- Hosted on [GitHub Pages](https://pages.github.com/) with a custom domain
- Data pipeline lives in [cta-insights](https://github.com/cailinpitt/cta-insights) — see its README for how alerts and observations are produced.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # run the Vitest suite
npm run lint     # Biome check (lint + format)
npm run format   # Biome check --write (autofix)
npm run build    # production build into dist/
```

PRs to `main` must pass both the test and lint jobs (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)) before they can be merged.
