import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const core = (p: string): string => decodeURIComponent(new URL(`../referral-core/src/${p}`, import.meta.url).pathname);

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^@myind\/referral-core\/testing$/, replacement: core('testing/index.ts') },
      { find: /^@myind\/referral-core$/, replacement: core('index.ts') },
    ],
  },
  test: {
    ...sharedTestConfig.test,
    environment: 'jsdom',
    // jsdom renders are slow on a loaded machine; the default 5 s flakes there.
    testTimeout: 30_000,
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
