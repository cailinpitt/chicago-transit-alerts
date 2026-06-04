// Single source of truth for where the client fetches the published data files
// (alerts.json, daily-counts.json). These are served only from the R2 data
// origin — there is no local fallback, so dev and production both fetch live
// from R2, which has CORS configured for chicagotransitalerts.app and for
// localhost. The origin can be overridden at build time via VITE_DATA_BASE_URL
// (e.g. a staging bucket), mirroring the DATA_ORIGIN_URL override in
// scripts/fetch-data.js, but defaults to the production R2 domain.
export const DATA_ORIGIN =
  import.meta.env.VITE_DATA_BASE_URL ?? 'https://data.chicagotransitalerts.app';

/** URL for a published data file, e.g. dataUrl('alerts.json'). */
export const dataUrl = (file) => `${DATA_ORIGIN}/${file}`;
