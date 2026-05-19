import { useEffect } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import AboutContent from './AboutContent.jsx';
import Header from './Header.jsx';

export default function AboutPage() {
  const [dark, toggleDark] = useDarkMode();

  useEffect(() => {
    document.title = 'About · Chicago Transit Alerts';
    return () => {
      document.title = 'Chicago Transit Alerts';
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={null}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
        alerts={null}
        observations={null}
      />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4 w-full flex-1">
        <div>
          <a
            href="/"
            className="text-sm text-blue-500 hover:text-blue-400 hover:underline inline-block mb-3"
          >
            ← Back to all incidents
          </a>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">About</h1>
          <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-6">
            <AboutContent />
          </div>
        </div>
      </main>
    </div>
  );
}
