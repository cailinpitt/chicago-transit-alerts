import { useState } from 'react';
import About from './About.jsx';
import Subscribe from './Subscribe.jsx';

export default function Footer() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  return (
    <>
      <footer
        className="border-t border-slate-200 dark:border-gh-border mt-8"
        style={{
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="max-w-5xl mx-auto px-4 pt-6 sm:pt-4 text-xs text-slate-500 dark:text-slate-400">
          Data provided by CTA. Unofficial — not affiliated with, endorsed by, or sponsored by the
          Chicago Transit Authority.
        </div>
        <div className="max-w-5xl mx-auto px-4 py-6 sm:py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Built by Cailin</span>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            About
          </button>
          <button
            type="button"
            onClick={() => setSubscribeOpen(true)}
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Subscribe
          </button>
          <a
            href="/privacy"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Privacy
          </a>
          <a
            href="https://bsky.app/profile/ticketmasterceo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Bluesky
          </a>
          <a
            href="https://github.com/cailinpitt/chicago-transit-alerts"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <Subscribe open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
    </>
  );
}
