// standard.site (https://standard.site) verification artifacts.
//
// Runs FIRST in the postbuild chain so the well-known verification endpoint is
// present before deploy. Per-event publication/document <link> tags are added by
// prerender-events.js; the SPA shell intentionally keeps its regular OG image
// card for the bare site URL.
//
// Also writes /.well-known/site.standard.publication — the *mandatory* half of
// publication verification (the <link> tag is only a hint). Its body is the
// plain-text publication AT-URI.
//
// Source: dist/data/standard-site.json (the manifest published by the insights
// backend, fetched into public/data/ at prebuild). No-ops when the manifest has
// no publication yet, so the site still builds before records are minted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const MANIFEST = resolve(DIST, 'data', 'standard-site.json');

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (_) {
    return { publication: null, documents: {} };
  }
}

const manifest = readManifest();
const publication = manifest.publication;

if (!publication) {
  console.warn('prerender-standard-site: no publication in manifest; skipping');
  process.exit(0);
}

// Mandatory verification endpoint: plain-text AT-URI body.
const wellKnownDir = resolve(DIST, '.well-known');
mkdirSync(wellKnownDir, { recursive: true });
writeFileSync(resolve(wellKnownDir, 'site.standard.publication'), `${publication}\n`);
console.log('prerender-standard-site: wrote /.well-known/site.standard.publication');
