import { useEffect, useState } from 'react';
import { BUS_ROUTE_NAMES, compareBusRoutes } from '../lib/busRoutes.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { dataUrl } from '../lib/dataSource.js';
import { METRA_LINE_ORDER, METRA_LINES } from '../lib/metraLines.js';

const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';
const SITE = 'https://chicagotransitalerts.app';
const FEED_URL = `${SITE}/feed.xml`;
const CSV_URL = 'https://chicagotransitalerts.app/data/alerts.csv';
const JSON_URL = dataUrl('alerts.json');
const CHANGELOG_URL = 'https://chicagotransitalerts.app/data/CHANGELOG.md';

const CURL_CMD = `curl -s ${JSON_URL} | jq '.incidents | length'`;

// Picker options for the per-line/route feed chooser. Values are the feed path
// segment after `/feed/` (e.g. `line/red`, `route/66`).
const LINE_FEED_OPTIONS = TRAIN_LINE_ORDER.map((id) => ({
  value: `line/${id}`,
  label: `${TRAIN_LINES[id]?.label ?? id} Line`,
}));
const ROUTE_FEED_OPTIONS = Object.keys(BUS_ROUTE_NAMES)
  .sort(compareBusRoutes)
  .map((r) => ({
    value: `route/${r}`,
    label: BUS_ROUTE_NAMES[r] ? `#${r} ${BUS_ROUTE_NAMES[r]}` : `#${r}`,
  }));
// Metra feeds live under their own namespace (`metra/line/:line`) so a Metra
// route_id can never collide with a CTA train-line key.
const METRA_FEED_OPTIONS = METRA_LINE_ORDER.map((id) => ({
  value: `metra/line/${id}`,
  label: METRA_LINES[id]?.label ?? id,
}));

export default function SubscribeContent() {
  const [copied, setCopied] = useState(null);
  const [pickedFeed, setPickedFeed] = useState('line/red');
  const pickedFeedUrl = `${SITE}/feed/${pickedFeed}.xml`;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = (key, text) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      // Clipboard API can fail in older Safari / restrictive contexts; the
      // text is visible and selectable either way.
    }
  };

  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <h3 className="font-semibold text-slate-700 dark:text-slate-200">Follow on Bluesky</h3>
      <p>
        The bots that feed this archive post directly to Bluesky in real time. Follow whichever
        modes you care about:
      </p>
      <ul className="list-disc list-outside ml-5 space-y-1">
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctaalertinsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            @ctaalertinsights
          </a>{' '}
          — official CTA alerts plus full-line/route blackouts and roundups.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctatraininsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            @ctatraininsights
          </a>{' '}
          — bunching, gaps, and ghost-hour detections on the L.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctabusinsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            @ctabusinsights
          </a>{' '}
          — same, for bus routes.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/metraalertinsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            @metraalertinsights
          </a>{' '}
          — Metra cancellations, late trains, and republished Metra alerts.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/metrainsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            @metrainsights
          </a>{' '}
          — Metra speed maps and performance recaps.
        </li>
      </ul>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-3">RSS / Atom feed</h3>
      <p>
        An Atom feed of the 50 most recent incidents — official CTA and Metra alerts plus
        bot-detected disruptions, across every line and route. Drop the URL below into any feed
        reader to follow along.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Capped at 50 entries, which typically covers the last 3–7 days depending on how active the
        system has been.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={FEED_URL}
          onFocus={(e) => e.target.select()}
          aria-label="Full feed URL"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-gh-bg border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200"
        />
        <button
          type="button"
          onClick={copy('feed', FEED_URL)}
          className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-gh-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gh-border transition-colors"
        >
          {copied === 'feed' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-3">
        Just one line or route
      </h3>
      <p>
        Only care about your commute? Pick a line or route to get its own feed — every CTA train
        line, every bus route, and every Metra line has one at a predictable URL (
        <code className="text-xs">/feed/line/:line.xml</code>,{' '}
        <code className="text-xs">/feed/route/:route.xml</code>, or{' '}
        <code className="text-xs">/feed/metra/line/:line.xml</code>):
      </p>
      <div className="space-y-2">
        <label htmlFor="feed-picker" className="sr-only">
          Choose a line or route
        </label>
        <select
          id="feed-picker"
          value={pickedFeed}
          onChange={(e) => setPickedFeed(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-gh-bg border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200"
        >
          <optgroup label="CTA Train Lines">
            {LINE_FEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="CTA Bus Routes">
            {ROUTE_FEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Metra Lines">
            {METRA_FEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={pickedFeedUrl}
            onFocus={(e) => e.target.select()}
            aria-label="Selected line or route feed URL"
            className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-gh-bg border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={copy('picked', pickedFeedUrl)}
            className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-gh-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gh-border transition-colors"
          >
            {copied === 'picked' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Feeds exist for every CTA line, every roster route, and every Metra line up front, so you
        can subscribe to your route today — it just stays quiet until something happens, then fills
        in automatically. Every line and route page also carries a{' '}
        <span className="whitespace-nowrap">“🔔 Subscribe (RSS)”</span> link. A JSON Feed version
        lives at the same path with a <code>.json</code> extension.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">
        Popular feed readers
      </h3>
      <ul className="list-disc list-outside ml-5 space-y-1">
        <li>
          <a className={LINK} href="https://feedly.com/" target="_blank" rel="noopener noreferrer">
            Feedly
          </a>{' '}
          — web and mobile.
        </li>
        <li>
          <a
            className={LINK}
            href="https://www.inoreader.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inoreader
          </a>{' '}
          — web and mobile.
        </li>
        <li>
          <a
            className={LINK}
            href="https://netnewswire.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            NetNewsWire
          </a>{' '}
          — free, native macOS / iOS.
        </li>
      </ul>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">What you'll get</h3>
      <p>
        New entries appear as incidents are detected. Resolved incidents bump their entry so most
        readers will mark them unread again — a quick way to see when something cleared.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        The feed regenerates each time the underlying data changes, roughly every 7 minutes when
        there's activity.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-3">Bulk data</h3>
      <p>
        Building a dashboard or doing analysis? The same data is published as JSON (a unified{' '}
        <code className="text-xs">incidents[]</code> array) and as a flat CSV (one row per alert or
        observation). No auth, no rate-limit beyond reasonable polling.
      </p>
      <ul className="list-disc list-outside ml-5 space-y-1 text-xs">
        <li>
          <a className={LINK} href={JSON_URL} target="_blank" rel="noopener noreferrer">
            {JSON_URL}
          </a>{' '}
          — unified incidents, the same shape the SPA reads.
        </li>
        <li>
          <a className={LINK} href={CSV_URL} target="_blank" rel="noopener noreferrer">
            {CSV_URL}
          </a>{' '}
          — flat CSV, one row per alert or observation.
        </li>
      </ul>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Format changes are tracked in the{' '}
        <a className={LINK} href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
          data changelog
        </a>{' '}
        — check it before pinning to the format.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">Quick check from a terminal:</p>
      <div className="flex items-center gap-2">
        <pre className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-gh-bg border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all">
          {CURL_CMD}
        </pre>
        <button
          type="button"
          onClick={copy('curl', CURL_CMD)}
          className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-gh-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gh-border transition-colors"
        >
          {copied === 'curl' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
