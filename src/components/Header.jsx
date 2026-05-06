const BOTS = [
  { label: 'CTA Alert Insights', emoji: '⚠️', href: 'https://bsky.app/profile/ctaalertinsights.bsky.social' },
  { label: 'CTA Train Insights', emoji: '🚇', href: 'https://bsky.app/profile/ctatraininsights.bsky.social' },
  { label: 'CTA Bus Insights', emoji: '🚌', href: 'https://bsky.app/profile/ctabusinsights.bsky.social' },
];

export default function Header({ generatedAt, dark, onToggleDark }) {
  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      }) + ' CT'
    : null;

  return (
    <header className="bg-white dark:bg-gh-surface border-b border-slate-200 dark:border-gh-border">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            CTA Alert History
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Major CTA alerts and service observations &middot;{' '}
            <span className="text-xs">Unofficial, not affiliated with the CTA</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-xs text-slate-400 dark:text-slate-500 mr-1">Bluesky bots</span>
            {BOTS.map((bot) => (
              <a
                key={bot.href}
                href={bot.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
              >
                <span>{bot.emoji}</span>
                <span className="hidden sm:inline">{bot.label}</span>
              </a>
            ))}
          </div>
          {/* Last updated — below bots on mobile, hidden on sm+ (shown in right column) */}
          {updatedStr && (
            <p className="sm:hidden text-xs text-slate-400 dark:text-slate-500 mt-2">
              Last updated {updatedStr}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 pt-1 flex-shrink-0">
          <button
            onClick={onToggleDark}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-base leading-none"
            aria-label="Toggle dark mode"
          >
            {dark ? '☀️' : '🌙'}
          </button>
          {/* Last updated — right of toggle on sm+, hidden on mobile */}
          {updatedStr && (
            <p className="hidden sm:block text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Last updated {updatedStr}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
