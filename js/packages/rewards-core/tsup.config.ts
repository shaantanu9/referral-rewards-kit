import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // One chunk shared by every entry in ESM and CJS, so the testing fakes throw the same error classes the core checks
  // with instanceof.
  splitting: true,
  treeshake: true,
  target: 'es2022',
});
