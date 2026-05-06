import { useState } from 'react';
import About from './About.jsx';

export default function Footer() {
  const [aboutOpen, setAboutOpen] = useState(false);
  return (
    <>
      <footer className="border-t border-slate-200 dark:border-gh-border mt-8">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
          <span>Built by Cailin</span>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            About
          </button>
          <a
            href="https://bsky.app/profile/ticketmasterceo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Bluesky
          </a>
          <a
            href="https://github.com/cailinpitt/cta-alert-history"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
