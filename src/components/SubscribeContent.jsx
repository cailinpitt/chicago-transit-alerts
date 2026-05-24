import { useEffect, useState } from 'react';

const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';
const FEED_URL = 'https://chicagotransitalerts.app/feed.xml';
const CSV_URL = 'https://chicagotransitalerts.app/data/alerts.csv';
const JSON_URL = 'https://chicagotransitalerts.app/data/alerts.json';
const CHANGELOG_URL = 'https://chicagotransitalerts.app/data/CHANGELOG.md';

const CURL_CMD = `curl -s ${JSON_URL} | jq '.incidents | length'`;

export default function SubscribeContent() {
  const [copied, setCopied] = useState(null);

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
      </ul>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-3">RSS / Atom feed</h3>
      <p>
        An Atom feed of the 50 most recent incidents — official CTA alerts and bot-detected
        disruptions, all lines and routes. Drop the URL below into any feed reader to follow along.
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
