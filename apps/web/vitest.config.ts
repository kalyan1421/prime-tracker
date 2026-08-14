/**
 * Component tests. Separate from vite.config.ts on purpose.
 *
 * The app config carries the dev server, its API proxy and the Tailwind plugin — none of
 * which a component test needs, and the proxy in particular would have tests inheriting
 * whichever API port happens to be in `.env`. This config is the React transform, jsdom,
 * and nothing else.
 *
 * Pinned to vitest 2.x because the app is on vite 5; vitest 3+ requires vite 6. Upgrading
 * vite to gain a test runner would be the tail wagging the dog.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // E2E lives in e2e/ and is Playwright's. Without this, vitest tries to collect those
    // files, fails on Playwright's imports, and reports a broken suite that is not broken.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
