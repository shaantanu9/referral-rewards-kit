// Shared vitest settings for every package. Dates are formatted and days are counted in UTC so tests do not depend
// on the machine's time zone (the Dart suites have the same rule, see docs/ISSUES.md "PGTZ=UTC").
(globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env['TZ'] = 'UTC';

export const sharedTestConfig = {
  test: {
    environment: 'node' as const,
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
};
