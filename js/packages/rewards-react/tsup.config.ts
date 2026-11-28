import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@myind/rewards-core'],
  // Every component uses hooks: the whole bundle is a client module for the Next.js App Router. No rollup treeshake
  // pass: it would strip the directive (the sources' own 'use client' lines are dropped by the bundler).
  banner: { js: "'use client';" },
});
