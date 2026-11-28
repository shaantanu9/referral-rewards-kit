// jest with React Native's own preset and @testing-library/react-native. The cores are mapped to their sources so the
// tests do not depend on a build. Under pnpm, packages live in node_modules/.pnpm/<name>@<v>/node_modules/<name>,
// so the transform allow-list also lets the .pnpm path through.
const transformed = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  '@react-native-async-storage',
  'expo(nent)?',
  '@expo(nent)?/.*',
  'expo-.*',
  'react-native-.*',
  '@testing-library',
];
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  transformIgnorePatterns: [`node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(${transformed.join('|')}))`],
  moduleNameMapper: {
    '^@myind/rewards-core$': '<rootDir>/../rewards-core/src/index.ts',
    '^@myind/rewards-core/testing$': '<rootDir>/../rewards-core/src/testing/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.tsx'],
  restoreMocks: true,
  testTimeout: 60000,
};
