# CTA Alert History

A public archive of major CTA service alerts and bot-detected disruptions — updated every 15 minutes.

**Live site:** https://cailinpitt.github.io/cta-alert-history/

## What's tracked

- **Official CTA alerts** — major service alerts posted by the CTA, captured via the CTA Alerts API
- **Bot-detected observations** — train stalls and gaps detected automatically by monitoring real-time train positions

Bus route observations are included when detected, but cannot be filtered by route.

## How it works

1. A home server runs a cron job every 15 minutes
2. The cron job exports alert data from a SQLite database to `public/data/alerts.json`
3. If the data changed, it commits and pushes to this repo
4. GitHub Actions builds the Vite app and deploys to GitHub Pages

## Stack

- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- Hosted on [GitHub Pages](https://pages.github.com/)
- Data pipeline lives in [cta-insights](https://github.com/cailinpitt/cta-insights)
