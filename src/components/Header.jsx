const BOTS = [
  { label: 'CTA Alert Insights', emoji: '⚠️', href: 'https://bsky.app/profile/ctaalertinsights.bsky.social' },
  { label: 'CTA Train Insights', emoji: '🚇', href: 'https://bsky.app/profile/ctatraininsights.bsky.social' },
  { label: 'CTA Bus Insights', emoji: '🚌', href: 'https://bsky.app/profile/ctabusinsights.bsky.social' },
];

export default function Header({ generatedAt }) {
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
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            CTA Alert History
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Major CTA alerts and service observations
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-xs text-slate-400">Bluesky bots</span>
            {BOTS.map((bot) => (
              <a
                key={bot.href}
                href={bot.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <span>{bot.emoji}</span>
                {bot.label}
              </a>
            ))}
          </div>
        </div>
        {updatedStr && (
          <p className="text-xs text-slate-400 pt-1 whitespace-nowrap flex-shrink-0">
            Updated {updatedStr}
          </p>
        )}
      </div>
    </header>
  );
}
