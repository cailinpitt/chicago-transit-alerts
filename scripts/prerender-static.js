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
    desc: 'Privacy policy for Chicago Transit Alerts: no accounts, no cookies, no analytics, and no third-party trackers.',
  },
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
