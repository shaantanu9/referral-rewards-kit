// Minimal assertions for the kit's Deno tests: no dependency, so `deno test` needs no download and no network.

function deepEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function fail(kind: string, actual: unknown, expected: unknown, msg?: string): never {
  throw new Error(
    `${kind} failed${msg ? ` (${msg})` : ""}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${
      JSON.stringify(expected)
    }`,
  );
}

const assert = {
  equal(actual: unknown, expected: unknown, msg?: string): void {
    if (!Object.is(actual, expected)) fail("equal", actual, expected, msg);
  },
  deepEqual(actual: unknown, expected: unknown, msg?: string): void {
    if (!deepEq(actual, expected)) fail("deepEqual", actual, expected, msg);
  },
  ok(value: unknown, msg?: string): void {
    if (!value) fail("ok", value, true, msg);
  },
  // deno-lint-ignore no-explicit-any
  throws(fn: () => unknown, errorClass: new (...args: any[]) => Error): void {
    try {
      fn();
    } catch (e) {
      if (e instanceof errorClass) return;
      fail("throws", e, errorClass.name);
    }
    fail("throws", "no error", errorClass.name);
  },
};

export default assert;
