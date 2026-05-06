export default function Header({ generatedAt }) {
  const updatedStr = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('en-US', {
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
            The Chicago transit history CTA&rsquo;s own site doesn&rsquo;t show
          </p>
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
