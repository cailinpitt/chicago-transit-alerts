import { useEffect, useState } from 'react';

const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';
const FEED_URL = 'https://chicagotransitalerts.app/feed.xml';

export default function Subscribe({ open, onClose }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FEED_URL);
      setCopied(true);
    } catch {
      // Clipboard API can fail in older Safari / restrictive contexts; the
      // URL is visible and selectable in the input either way.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscribe-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-gh-border text-xl leading-none"
        >
          ×
        </button>

        <h2
          id="subscribe-title"
          className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3"
        >
          Subscribe
        </h2>

        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            An Atom feed of the 50 most recent incidents — official CTA alerts and bot-detected
            disruptions, all lines and routes. Drop the URL below into any feed reader to follow
            along.
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
              onClick={copy}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-gh-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gh-border transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">
            Popular feed readers
          </h3>
          <ul className="list-disc list-outside ml-5 space-y-1">
            <li>
              <a
                className={LINK}
                href="https://feedly.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
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
            New entries appear as incidents are detected. Resolved incidents bump their entry so
            most readers will mark them unread again — a quick way to see when something cleared.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The feed regenerates each time the underlying data changes, roughly every 7 minutes when
            there's activity.
          </p>
        </div>
      </div>
    </div>
  );
}
