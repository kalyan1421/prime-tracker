/**
 * On-demand pages and the deploy trap: a tab opened before a deploy asks for chunk file
 * names the deploy replaced. lazyPage reloads ONCE to pick up the new build, and never
 * loops when a chunk is genuinely missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { lazyPage } from './lazyPage';

const reload = vi.fn();
const original = window.location;

beforeEach(() => {
  reload.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original });
});

const show = (Page: any) => render(
  <ErrorBoundary section="page">
    <Suspense fallback={<p>loading</p>}><Page /></Suspense>
  </ErrorBoundary>,
);

describe('lazyPage', () => {
  it('renders the page once its chunk arrives', async () => {
    const Page = lazyPage(() => Promise.resolve({ default: () => <p>Site Tracker</p> }));
    show(Page);
    expect(await screen.findByText('Site Tracker')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a chunk from an older deploy is gone', async () => {
    const Page = lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    show(Page);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('prime-chunk-reload-at')).toBeTruthy();
  });

  it('does not reload again straight after a reload — a missing chunk must not loop', async () => {
    sessionStorage.setItem('prime-chunk-reload-at', String(Date.now()));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Page = lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    show(Page);
    // The error reaches the page's error boundary instead.
    await vi.waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(reload).not.toHaveBeenCalled();
  });
});
