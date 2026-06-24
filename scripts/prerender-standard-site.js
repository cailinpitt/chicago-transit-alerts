// standard.site (https://standard.site) verification artifacts.
//
// Runs FIRST in the postbuild chain so the publication <link> tag lands in the
// SPA shell (dist/index.html) before prerender-events / prerender-pages clone
// it — every prerendered page then inherits the publication discovery hint, and
// the home page (the shell itself) carries it, which Bluesky requires to render
// the enhanced publication card. Per-event document <link> tags are added by
// prerender-events.js.
//
// Also writes /.well-known/site.standard.publication — the *mandatory* half of
// publication verification (the <link> tag is only a hint). Its body is the
// plain-text publication AT-URI.
//
// Source: dist/data/standard-site.json (the manifest published by the insights
// backend, fetched into public/data/ at prebuild). No-ops when the manifest has
// no publication yet, so the site still builds before records are minted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const MANIFEST = resolve(DIST, 'data', 'standard-site.json');
const SHELL = resolve(DIST, 'index.html');

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

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

// Inject the publication discovery hint into the shell <head> (idempotent).
const tag = `<link rel="site.standard.publication" href="${escAttr(publication)}" />`;
if (existsSync(SHELL)) {
  let html = readFileSync(SHELL, 'utf8');
  if (!html.includes('rel="site.standard.publication"')) {
    html = html.replace('</head>', `  ${tag}\n  </head>`);
    writeFileSync(SHELL, html);
    console.log(`prerender-standard-site: injected publication tag into shell -> ${publication}`);
  }
}

// Mandatory verification endpoint: plain-text AT-URI body.
const wellKnownDir = resolve(DIST, '.well-known');
mkdirSync(wellKnownDir, { recursive: true });
writeFileSync(resolve(wellKnownDir, 'site.standard.publication'), `${publication}\n`);
console.log('prerender-standard-site: wrote /.well-known/site.standard.publication');
