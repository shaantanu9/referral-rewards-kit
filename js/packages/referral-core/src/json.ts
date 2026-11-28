/** Tolerant JSON readers shared by the models. Internal. */

export type JsonMap = Readonly<Record<string, unknown>>;

export class ReferralFormatException extends Error {
  override readonly name = 'ReferralFormatException';
  constructor(message: string) {
    super(`ReferralFormatException: ${message}`);
  }
  override toString(): string {
    return this.message;
  }
}

const typeName = (v: unknown): string => (v === null ? 'Null' : Array.isArray(v) ? 'List' : typeof v);

export function asMap(v: unknown, what: string): JsonMap {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as JsonMap;
  throw new ReferralFormatException(`${what}: expected an object, got ${typeName(v)}`);
}

export function asList(v: unknown, what: string): readonly unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  throw new ReferralFormatException(`${what}: expected a list, got ${typeName(v)}`);
}

export const isMap = (v: unknown): v is JsonMap => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Dart `int.tryParse` / `num.toInt()`: whole numbers only from strings; numbers are truncated. */
export function optInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

export const str = (v: unknown): string => (v == null ? '' : String(v));
export const optStr = (v: unknown): string | null => (v == null ? null : String(v));

const iso =
  /^([+-]?\d{4,6})-?(\d\d)-?(\d\d)(?:[ T](\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d+))?)?)?( ?[zZ]| ?([-+])(\d\d)(?::?(\d\d))?)?)?$/;

/**
 * Dart's `DateTime.tryParse`: ISO 8601 and the Postgres text form (`2026-11-20 10:00:00+00`). A value with a zone is
 * an instant; one without is read as local time, or as UTC when [noZoneIsUtc] (the rewards server sends UTC).
 */
export function parseDateTime(v: unknown, noZoneIsUtc = false): Date | null {
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
  let d: Date;
  if (m[8]) {
    let t = Date.UTC(year, month, day, hour, minute, second, ms);
    if (m[9]) {
      const sign = m[9] === '-' ? -1 : 1;
      const off = parseInt(m[10]!, 10) * 60 + (m[11] ? parseInt(m[11], 10) : 0);
      t -= sign * off * 60000;
    }
    d = new Date(t);
  } else if (noZoneIsUtc) {
    d = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
  } else {
    d = new Date(year, month, day, hour, minute, second, ms);
  }
  if (year >= 0 && year < 100) {
    if (m[8] || noZoneIsUtc) d.setUTCFullYear(year);
    else d.setFullYear(year);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export const optMap = (v: unknown): JsonMap => (isMap(v) ? v : {});
