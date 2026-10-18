import { lazy, type ComponentType } from 'react';

/**
 * A route-level page loaded on demand (2026-10-17). The app used to ship as ONE 2.9 MB
 * script, so a site user on a phone downloaded the reports, charts and admin screens just
 * to post an update. Each page is now its own chunk, fetched the first time it is opened.
 *
 * The one trap with on-demand chunks: a tab opened before a deploy still asks for the OLD
 * hashed file names, which the deploy has replaced. nginx then answers with index.html and
 * the import fails. When that happens the page reloads ONCE to pick up the new build;
 * the timestamp guard stops a genuinely missing chunk from reloading forever.
 */
const RELOAD_KEY = 'prime-chunk-reload-at';

function reloadedRecently() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 30_000; } catch { return true; }
}

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => load().catch((err) => {
    if (!reloadedRecently()) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* private mode */ }
      window.location.reload();
      return new Promise<{ default: T }>(() => {}); // the reload replaces this page
    }
    throw err;
  }));
}
