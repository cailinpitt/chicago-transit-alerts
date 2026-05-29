// Back-navigation helpers for the per-page "← Back …" links.
//
// These pages are full-page navigations (no client router), so an
// `<a href="/">` is a *forward* navigation to a fresh history entry that
// always lands at the top. To restore the visitor's prior scroll position
// (and the incident list's pagination) we instead trigger a real
// `history.back()` when the previous page is one we can return to — the
// browser's native scroll restoration then takes over.

// A modified or non-primary click (cmd/ctrl/shift/alt or middle-click to open
// in a new tab/window) should be left to the browser. Also bail if something
// upstream already handled the event.
function isPlainClick(event) {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

// Same-origin referrer as a URL, or null (empty/external/unparseable).
function inAppReferrer() {
  if (typeof window === 'undefined') return null;
  let ref = null;
  try {
    ref = document.referrer ? new URL(document.referrer) : null;
  } catch {
    ref = null;
  }
  return ref != null && ref.origin === window.location.origin ? ref : null;
}

// Resolve the "back" affordance for a page reachable from many contexts.
// Returns `{ label, href, onClick }`, adapting to how the visitor arrived:
//   • from the home incident list → "Back to all incidents", history.back()
//     (restores their scroll position + pagination).
//   • from another in-app page (system health, a line/station/day page, or
//     another event) → "Back", history.back() to that page (scroll restored).
//   • from a deep/shared/external link, or a new tab with no in-app history →
//     "Back to all incidents" linking to home, since there's no prior
//     position to return to.
// `onClick` is omitted when there's nothing to intercept (the plain home link
// case), so the href handles it.
export function resolveBackNav() {
  const homeNav = { label: 'Back to all incidents', href: '/' };
  if (typeof window === 'undefined') return homeNav;

  const ref = inAppReferrer();
  // No usable in-app history to return to — behave like the plain home link.
  if (ref == null || window.history.length <= 1) return homeNav;

  const isHome = ref.pathname === '/' || ref.pathname === '';
  return {
    label: isHome ? 'Back to all incidents' : 'Back',
    href: isHome ? '/' : `${ref.pathname}${ref.search}`,
    onClick(event) {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      window.history.back();
    },
  };
}
