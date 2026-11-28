import { defineConfig } from 'tsup';

// Each optional native library has its own entry, so an app bundles only the adapters it imports (Metro follows the
// `exports` map). react, react-native, the core and every optional library stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    notifications: 'src/adapters/notifications.ts',
    clipboard: 'src/adapters/clipboard.ts',
    'view-shot': 'src/adapters/view-shot.ts',
    'async-storage': 'src/adapters/async-storage.ts',
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
