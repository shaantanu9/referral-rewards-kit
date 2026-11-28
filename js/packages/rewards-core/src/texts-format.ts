/** Small formatters used by the texts (ports of the helpers in texts.dart, texts_v2.dart, texts_reveal.dart, texts_leagues.dart). */

/** "2d 4h", "3h 05m", "4m 09s", "9s" for a duration in milliseconds. */
export function formatLeft(ms: number): string {
  const total = ms < 0 || !Number.isFinite(ms) ? 0 : ms;
  const sec = Math.floor(total / 1000);
  const days = Math.floor(sec / 86400),
    hoursTotal = Math.floor(sec / 3600),
    minutesTotal = Math.floor(sec / 60);
  const h = hoursTotal % 24,
    m = minutesTotal % 60,
    s = sec % 60;
  const two = (v: number): string => String(v).padStart(2, '0');
  if (days > 0) return `${days}d ${h}h`;
  if (hoursTotal > 0) return `${h}h ${two(m)}m`;
  if (minutesTotal > 0) return `${m}m ${two(s)}s`;
  return `${s}s`;
}

/** `chapter_read` → "Chapter read". */
export function humanize(key: string): string {
  const t = key.replaceAll('_', ' ').trim();
  return t === '' ? t : t[0]!.toUpperCase() + t.substring(1);
}

/** A chance 0..1 as an honest percentage: whole when whole, one decimal below 10 %, "<0.1%" for tiny ones. */
export function formatPercent(chance: number): string {
  const p = chance * 100;
  if (p <= 0) return '0%';
  if (p < 0.1) return '<0.1%';
  if (p === Math.round(p)) return `${Math.trunc(p)}%`;
  if (p < 10) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/**
 * "1 in N" when 1/[chance] is within 0.05 of a whole number N ≥ 2 (0.1 → "1 in 10", 0.33 → "1 in 3"), otherwise a
 * percentage with a space ("35 %", "1.5 %", "100 %").
 */
export function formatChance(chance: number): string {
  if (chance > 0 && chance < 1) {
    const inverse = 1 / chance;
    const n = Math.round(inverse);
    if (n >= 2 && Math.abs(inverse - n) <= 0.05) return `1 in ${n}`;
  }
  return formatPercent(chance).replace('%', ' %');
}

/** English ordinal suffix: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinalSuffix(n: number): string {
  const h = n % 100;
  if (h >= 11 && h <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
