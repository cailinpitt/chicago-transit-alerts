import { resolveBackNav } from '../lib/backNav.js';

// Shared "← Back …" link for the per-page headers. Label and target adapt to
// how the visitor arrived (see resolveBackNav): a real history.back() to the
// previous in-app page with their scroll position restored, or a plain link to
// the home incident list when there's no in-app history to return to
// (deep/shared links, opened-in-a-new-tab). `className` lets each page keep its
// own spacing.
export default function BackLink({ className }) {
  const back = resolveBackNav();
  return (
    <a href={back.href} onClick={back.onClick} className={className}>
      ← {back.label}
    </a>
  );
}
