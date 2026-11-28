import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (p: string): string => decodeURIComponent(new URL(`../../packages/${p}`, import.meta.url).pathname);

// The demo runs on the packages' sources, so it needs no package build first.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@myind\/rewards-core\/testing$/, replacement: pkg('rewards-core/src/testing/index.ts') },
      { find: /^@myind\/rewards-core$/, replacement: pkg('rewards-core/src/index.ts') },
      { find: /^@myind\/rewards-react\/styles\.css$/, replacement: pkg('rewards-react/src/styles.css') },
      { find: /^@myind\/rewards-react$/, replacement: pkg('rewards-react/src/index.ts') },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
