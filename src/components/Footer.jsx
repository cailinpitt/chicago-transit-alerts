export default function Footer() {
  return (
    <footer className="border-t border-slate-200 mt-8">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>Built by Cailin</span>
        <a
          href="https://bsky.app/profile/ticketmasterceo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-600 transition-colors"
        >
          Bluesky
        </a>
        <a
          href="https://github.com/cailinpitt/cta-alert-history"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-600 transition-colors"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
