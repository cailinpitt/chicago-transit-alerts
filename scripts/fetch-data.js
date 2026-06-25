// Fetch the published data into public/data/ *before* the build, so the
// deployed snapshot + the postbuild steps (prerender-events, prerender-pages,
// generate-feed, generate-sitemap, generate-csv) have current data without it
// being committed to the repo. Runs automatically as the npm `prebuild` hook.
//
// alerts.json is no longer a published artifact — the data origin now serves the
// bounded shards (alerts-recent.json + monthly alerts/<YYYY-MM>.json + the
// index). The build still needs the *all-time* set (per-event OG cards, the
// sitemap, the full CSV), so we reassemble it here from the shards: every
// monthly archive shard is the complete partition of history by first_seen
// month, unioned with any active-but-unarchived incident the recent slice
// carries. The result is byte-compatible with the old alerts.json shape, so the
// postbuild scripts read it unchanged.
//
// Resilience: if the origin is unreachable but a local copy already exists
// (e.g. during local development, or a transient R2 hiccup), we keep the
// existing file rather than failing the build — "slightly stale" beats "no
// deploy". We only hard-fail if there's no alerts.json at all, since the
// prerender can't run without it.
//
// Env:
//   DATA_ORIGIN_URL   override the origin (default: the prod R2 custom domain)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIGIN = (process.env.DATA_ORIGIN_URL || 'https://data.chicagotransitalerts.app').replace(
  /\/$/,
  '',
);
const OUT_DIR = resolve(__dirname, '..', 'public', 'data');
// Files still published verbatim by the producer.
const PLAIN_FILES = ['daily-counts.json', 'accessibility.json'];

mkdirSync(OUT_DIR, { recursive: true });

async function getJson(file) {
  const res = await fetch(`${ORIGIN}/${file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Reassemble the all-time alerts.json from the published shards. The monthly
// shards partition every archived incident by first_seen month; the recent
// slice supplies any active incident that has no first_seen (so isn't archived).
async function assembleAlerts() {
  const index = await getJson('alerts-index.json');
  const months = index.months ?? [];
  const shards = await Promise.all(months.map((m) => getJson(m.url)));

  const incidents = [];
  const seen = new Set();
  // index.months is newest-first and each shard preserves first_seen-DESC order,
  // so concatenating in index order reproduces the old global newest-first order.
  for (const shard of shards) {
    for (const inc of shard.incidents ?? []) {
      incidents.push(inc);
      seen.add(inc.id);
    }
  }
  // Active-but-unarchived incidents (no first_seen) ride only the recent slice.
  const recent = await getJson('alerts-recent.json');
  for (const inc of recent.incidents ?? []) {
    if (!seen.has(inc.id)) incidents.unshift(inc);
  }

  return {
    schema_version: index.schema_version ?? recent.schema_version ?? 2,
    generated_at: index.generated_at ?? recent.generated_at ?? Date.now(),
    data_start_ts: index.data_start_ts ?? null,
    incidents,
  };
}

const alertsDest = resolve(OUT_DIR, 'alerts.json');
try {
  const assembled = await assembleAlerts();
  writeFileSync(alertsDest, `${JSON.stringify(assembled)}\n`);
  console.log(
    `fetch-data: assembled alerts.json from shards (${assembled.incidents.length} incidents)`,
  );
} catch (err) {
  if (existsSync(alertsDest)) {
    console.warn(
      `fetch-data: shard assembly failed (${err.message}); using existing ${alertsDest}`,
    );
  } else {
    console.error(`fetch-data: shard assembly failed (${err.message}) and no local copy`);
  }
}

for (const file of PLAIN_FILES) {
  const dest = resolve(OUT_DIR, file);
  try {
    const res = await fetch(`${ORIGIN}/${file}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, body);
    console.log(`fetch-data: ${file} <- ${ORIGIN}/${file} (${body.length} bytes)`);
  } catch (err) {
    if (existsSync(dest)) {
      console.warn(`fetch-data: ${file} fetch failed (${err.message}); using existing ${dest}`);
    } else {
      console.warn(`fetch-data: ${file} fetch failed (${err.message}) and no local copy`);
    }
  }
}

if (!existsSync(alertsDest)) {
  console.error(
    'fetch-data: no alerts.json available (origin down, no local copy) — aborting build',
  );
  process.exit(1);
}

if (!existsSync(resolve(OUT_DIR, 'accessibility.json'))) {
  writeFileSync(
    resolve(OUT_DIR, 'accessibility.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        generated_at: Date.now(),
        data_start_ts: null,
        window_days: 180,
        outages: [],
      },
      null,
      2,
    )}\n`,
  );
  console.warn('fetch-data: wrote empty accessibility.json fallback');
}
