// jest with React Native's own preset and @testing-library/react-native. The cores are mapped to their sources so the
// demo test does not depend on a build. Under pnpm, packages live in node_modules/.pnpm/<name>@<v>/node_modules/<name>,
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
    // Every copy of these (the packages resolve their own) goes to one stub: no Expo native runtime in jest.
    '^expo-clipboard$': '<rootDir>/test/mocks/expo-clipboard.ts',
    '^(expo-status-bar|react-native-qrcode-svg)$': '<rootDir>/test/mocks/null-component.ts',
    '^@myind/(referral|rewards)-core$': '<rootDir>/../../packages/$1-core/src/index.ts',
    '^@myind/(referral|rewards)-core/testing$': '<rootDir>/../../packages/$1-core/src/testing/index.ts',
    '^@myind/(referral|rewards)-react-native$': '<rootDir>/../../packages/$1-react-native/src/index.ts',
    '^@myind/(referral|rewards)-react-native/(.*)$': '<rootDir>/../../packages/$1-react-native/src/adapters/$2',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.tsx'],
  testTimeout: 120000,
  restoreMocks: true,
};
