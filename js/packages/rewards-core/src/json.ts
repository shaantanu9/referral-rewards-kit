/** Tolerant JSON readers shared by the models. Internal (port of `json.dart`). */
import { RewardsFormatException } from './errors';

export type JsonMap = Readonly<Record<string, unknown>>;

/** Decodes a JSON string result (raw HTTP adapters) and passes anything else through. */
export const decodeResult = (v: unknown): unknown => (typeof v === 'string' ? (JSON.parse(v) as unknown) : v);

export const isMap = (v: unknown): v is JsonMap => v !== null && typeof v === 'object' && !Array.isArray(v);

const typeName = (v: unknown): string => (v === null ? 'Null' : Array.isArray(v) ? 'List' : typeof v);

export function asMap(v: unknown, what: string): JsonMap {
  if (isMap(v)) return v;
  throw new RewardsFormatException(`${what}: expected an object, got ${typeName(v)}`);
}

/** A map, or empty for anything else (optional `params` / `public` objects). */
export const optMap = (v: unknown): JsonMap => (isMap(v) ? v : {});

export function asList(v: unknown, what: string): readonly unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  throw new RewardsFormatException(`${what}: expected a list, got ${typeName(v)}`);
}

/** Parses each item of an optional list with [f], skipping items that are not objects. */
export function listOf<T>(v: unknown, f: (m: JsonMap) => T): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) if (isMap(item)) out.push(f(item));
  return out;
}

export function optInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}
export const intOr = (v: unknown, fallback = 0): number => optInt(v) ?? fallback;

export function numOr(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

export const boolOr = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : fallback;
export const str = (v: unknown): string => (v == null ? '' : String(v));
export const optStr = (v: unknown): string | null => (v == null ? null : String(v));

/** A chance 0 < c ≤ 1 (`params.chance`), or null for anything else. */
export function optChance(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : null;
  if (n == null || Number.isNaN(n) || n <= 0 || n > 1) return null;
  return n;
}

/** `[min, max]` whole numbers with 0 ≤ min ≤ max (`params.amount_range`, a grant's `params.range`), or null. */
export function optRange(v: unknown): readonly [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const whole = (x: unknown): number | null => {
    const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : null;
    if (n == null || !Number.isFinite(n) || n !== Math.round(n)) return null;
    return n;
  };
  const lo = whole(v[0]),
    hi = whole(v[1]);
  if (lo == null || hi == null || lo < 0 || lo > hi) return null;
  return [lo, hi];
}

const iso =
  /^([+-]?\d{4,6})-?(\d\d)-?(\d\d)(?:[ T](\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d+))?)?)?( ?[zZ]| ?([-+])(\d\d)(?::?(\d\d))?)?)?$/;

/** An ISO 8601 (or Postgres text) time as an instant. A time without a zone is read as UTC (the server sends UTC). */
export function time(v: unknown): Date | null {
  if (typeof v !== 'string' || v === '') return null;
  const m = iso.exec(v.trim());
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10) - 1;
  const day = parseInt(m[3]!, 10);
  const hour = m[4] ? parseInt(m[4], 10) : 0;
  const minute = m[5] ? parseInt(m[5], 10) : 0;
  const second = m[6] ? parseInt(m[6], 10) : 0;
  const ms = m[7] ? Math.round(parseInt(m[7].padEnd(6, '0').substring(0, 6), 10) / 1000) : 0;
  if (month > 11 || day > 31 || hour > 24 || minute > 59 || second > 59) return null;
  let t = Date.UTC(year, month, day, hour, minute, second, ms);
  if (m[9]) {
    const sign = m[9] === '-' ? -1 : 1;
    t -= sign * (parseInt(m[10]!, 10) * 60 + (m[11] ? parseInt(m[11], 10) : 0)) * 60000;
  }
  const d = new Date(t);
  if (year >= 0 && year < 100) d.setUTCFullYear(year);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Dart's `num.clamp(0, 1)` for a ratio. */
export const clamp01 = (n: number): number => (Number.isNaN(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);
