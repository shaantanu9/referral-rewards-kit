import { defineConfig } from 'tsup';

// Each optional native library has its own entry, so an app bundles only the adapters it imports (Metro follows the
// `exports` map). react, react-native, the core and every optional library stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'async-storage': 'src/adapters/async-storage.ts',
    'secure-store': 'src/adapters/secure-store.ts',
    clipboard: 'src/adapters/clipboard.tsx',
    netinfo: 'src/adapters/netinfo.ts',
    'install-referrer': 'src/adapters/install-referrer.ts',
    qrcode: 'src/adapters/qrcode.tsx',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
