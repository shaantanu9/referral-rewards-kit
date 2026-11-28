import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  target: 'es2022' as const,
  external: ['next', 'next/og', 'react', 'react-dom', '@myind/referral-core', '@myind/referral-react'],
};

export default defineConfig([
  // Server-safe helpers and the next/og image: no "use client".
  { ...shared, entry: { index: 'src/index.ts', og: 'src/og-image.tsx' } },
  // The attribution link re-exports a client component: keep the boundary explicit.
  { ...shared, entry: { attribution: 'src/attribution.ts' }, banner: { js: '"use client";' } },
]);
