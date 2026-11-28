import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  // No rollup treeshake pass: it drops the banner below (esbuild already drops unused ESM code).
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Every export is a client component or hook: one "use client" for the bundle keeps it usable from Next.js server
  // components (the source files carry the directive too; esbuild drops it when bundling).
  banner: { js: '"use client";' },
  external: ['react', 'react-dom', '@myind/referral-core'],
  onSuccess: 'cp src/styles.css dist/styles.css',
});
