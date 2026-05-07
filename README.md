# CTA Alert History

A public archive of Chicago Transit Authority service alerts and bot-detected disruptions, with a GitHub-style heatmap of incident frequency over the last 90 days.

> **Unofficial project.** Not affiliated with, endorsed by, or sponsored by the Chicago Transit Authority.

**Live site:** https://chicagotransitalerts.app

![Timeline view: 90-day per-line heatmap of CTA incidents](docs/images/website-timeline.png)

![Incident list: chronological feed of recent alerts and bot observations](docs/images/website-incidents-list.png)

## What you see

- **Active alerts** — anything currently disrupting service, surfaced at the top of the page.
- **90-day timeline** — a per-line contribution-style grid showing which days had incidents and roughly how many. Click a line name to filter the timeline and the list to that line only.
- **Incident list** — chronological list of every captured alert and observation, filterable by train line, by bus route, and by time window (7d / 30d / 90d / all).

## What's tracked

Two distinct sources, displayed together:

- **Official CTA alerts** — significant service alerts published by the CTA, captured via the CTA Alerts API and republished by the [@ctaalertinsights.bsky.social](https://bsky.app/profile/ctaalertinsights.bsky.social) Bluesky bot.
- **Bot-detected observations** — service disruptions inferred from live train and bus positions, including cold stretches with no service for 15+ min, vehicle bunching, long gaps versus the scheduled headway, and "ghost" hours where materially fewer vehicles are running than the schedule implies. Posted by [@ctatraininsights](https://bsky.app/profile/ctatraininsights.bsky.social) and [@ctabusinsights](https://bsky.app/profile/ctabusinsights.bsky.social).

When an official alert and a bot observation describe the same incident on the same line within a couple of hours, they're merged into a single entry rather than double-counted.

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
