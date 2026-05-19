import { useEffect } from 'react';
import AboutContent from './AboutContent.jsx';

export default function About({ open, onClose }) {
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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
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

        <h2 id="about-title" className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3">
          About
        </h2>

        <AboutContent />
      </div>
    </div>
  );
}
