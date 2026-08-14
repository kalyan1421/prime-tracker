/**
 * Test environment setup, run once per test file.
 *
 * jsdom implements the DOM but not the browser APIs component libraries reach for.
 * HeroUI and react-aria in particular call matchMedia and ResizeObserver during render,
 * and their absence surfaces as "x is not a function" from inside node_modules — an
 * error that points nowhere near the component actually under test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount between cases. Without it, `getByText` searches the leftovers of every earlier
// test in the file and starts failing on ambiguity for reasons that look like a bug in
// the component.
afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
