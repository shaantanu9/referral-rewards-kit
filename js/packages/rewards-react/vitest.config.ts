import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared';

const src = (p: string): string => decodeURIComponent(new URL(p, import.meta.url).pathname);

export default defineConfig({
  ...sharedTestConfig,
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Test against the core's source (like tsconfig.json's paths), so no build is needed first.
    alias: [
      { find: /^@myind\/rewards-core\/testing$/, replacement: src('../rewards-core/src/testing/index.ts') },
      { find: /^@myind\/rewards-core$/, replacement: src('../rewards-core/src/index.ts') },
    ],
  },
  test: {
    ...sharedTestConfig.test,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    // Let `styles.css?raw` through as text (test/styles.test.ts checks it against the core's theme tokens).
    css: { include: [/styles\.css/] },
    // Other worktrees build in parallel on this machine; jsdom renders can be slow under that load.
    testTimeout: 30000,
  },
});
