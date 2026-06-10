// Prerender minimal HTML stubs for the static, non-data-driven SPA routes
// (/about, /subscribe, /privacy). Unlike the line/route/station pages, these
// aren't covered by prerender-pages.js, so without a real index.html they would
// 404 for crawlers and inherit the homepage's canonical. Emit a self-canonical
// stub each so they return 200, carry their own title/description, and are safe
// to list in the sitemap. They reuse the homepage OG card — no per-page image.
//
// Runs in postbuild after `vite build` has produced dist/index.html (the shell).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRA_LINE_ORDER, METRA_LINES } from '../src/lib/metraLines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const SHELL = resolve(DIST, 'index.html');
const SITE = 'https://chicagotransitalerts.app';

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PAGES = [
  {
    path: '/about',
    title: 'About',
    desc: 'About Chicago Transit Alerts — an unofficial public archive of CTA service alerts and bot-detected disruptions, and where the data comes from.',
  },
  {
    path: '/subscribe',
    title: 'Subscribe',
    desc: 'Subscribe to CTA service-alert feeds — a global Atom/JSON feed plus a feed for every train line and bus route.',
  },
  {
    path: '/privacy',
    title: 'Privacy',
    desc: 'Privacy policy for Chicago Transit Alerts: no accounts, no cookies, no advertising, and only cookieless Cloudflare Web Analytics for aggregate page-view counts.',
  },
  // Metra roster pages. These render client-side from alerts.json; the stubs
  // give crawlers a self-canonical 200 with proper title/description so they
  // can be listed in the sitemap. Per-page Metra OG images are still deferred,
  // so they reuse the homepage OG card like the other static stubs.
  {
    path: '/system/metra',
    title: 'Metra system health',
    desc: 'Every Metra line at a glance — active disruptions, cancellations, and delays over the last 30 days, on Chicago Transit Alerts.',
  },
  ...METRA_LINE_ORDER.map((line) => {
    const info = METRA_LINES[line];
    return {
      path: `/metra/line/${line}`,
      title: `${info.label} (Metra)`,
      desc: `Service alerts, cancellations, and delays for the Metra ${info.label} line — archived on Chicago Transit Alerts.`,
    };
  }),
];

const shell = readFileSync(SHELL, 'utf8');

for (const page of PAGES) {
  const url = `${SITE}${page.path}`;
  const title = `${page.title} · Chicago Transit Alerts`;
  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escAttr(url)}" />`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escAttr(page.desc)}" />`,
    )
    .replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escAttr(title)}" />`,
    )
    .replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escAttr(page.desc)}" />`,
    )
    .replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escAttr(url)}" />`,
    )
    .replace(
      /<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escAttr(title)}" />`,
    )
    .replace(
      /<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escAttr(page.desc)}" />`,
    );
  const outDir = resolve(DIST, page.path.slice(1));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'index.html'), html);
}

console.log(`prerender-static: wrote ${PAGES.length} static page stubs`);
