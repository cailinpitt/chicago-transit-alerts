import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBackNav } from '../lib/backNav.js';

const ORIGIN = window.location.origin;

function setReferrer(value) {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

function setHistoryLength(n) {
  Object.defineProperty(window.history, 'length', { value: n, configurable: true });
}

// A plain left-click synthetic event. `button: 0` matters — the modified-click
// guard treats a missing/non-zero button as "let the browser handle it".
function clickEvent(extra = {}) {
  return { preventDefault: vi.fn(), button: 0, ...extra };
}

afterEach(() => {
  setReferrer('');
  setHistoryLength(1);
  vi.restoreAllMocks();
});

describe('resolveBackNav', () => {
  it('falls back to the home link when there is no referrer', () => {
    setReferrer('');
    setHistoryLength(2);
    expect(resolveBackNav()).toEqual({ label: 'Back to all incidents', href: '/' });
  });

  it('falls back to the home link for an external referrer', () => {
    setReferrer('https://www.google.com/search?q=cta');
    setHistoryLength(2);
    expect(resolveBackNav()).toEqual({ label: 'Back to all incidents', href: '/' });
  });

  it('falls back to the home link when there is no in-app history to return to', () => {
    setReferrer(`${ORIGIN}/system/trains`);
    setHistoryLength(1);
    expect(resolveBackNav()).toEqual({ label: 'Back to all incidents', href: '/' });
  });

  it('keeps the "all incidents" label but uses history.back() when coming from home', () => {
    setReferrer(`${ORIGIN}/?lines=red`);
    setHistoryLength(2);
    const nav = resolveBackNav();
    expect(nav.label).toBe('Back to all incidents');
    expect(nav.href).toBe('/');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const event = clickEvent();
    nav.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  it('adapts to "Back" and returns to the referrer page from another in-app page', () => {
    setReferrer(`${ORIGIN}/system/trains`);
    setHistoryLength(3);
    const nav = resolveBackNav();
    expect(nav.label).toBe('Back');
    expect(nav.href).toBe('/system/trains');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    nav.onClick(clickEvent());
    expect(back).toHaveBeenCalled();
  });

  it('preserves the referrer query string in the fallback href', () => {
    setReferrer(`${ORIGIN}/compare?trains=red,blue`);
    setHistoryLength(2);
    expect(resolveBackNav().href).toBe('/compare?trains=red,blue');
  });

  it('leaves modified clicks (open in new tab) to the browser', () => {
    setReferrer(`${ORIGIN}/system/trains`);
    setHistoryLength(2);
    const nav = resolveBackNav();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const event = clickEvent({ metaKey: true });
    nav.onClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});
