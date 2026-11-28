import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const src = (p: string): string => decodeURIComponent(new URL(`../${p}`, import.meta.url).pathname);

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^@myind\/referral-core\/testing$/, replacement: src('referral-core/src/testing/index.ts') },
      { find: /^@myind\/referral-core$/, replacement: src('referral-core/src/index.ts') },
      { find: /^@myind\/referral-react$/, replacement: src('referral-react/src/index.ts') },
    ],
  },
  test: {
    ...sharedTestConfig.test,
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
  },
});
