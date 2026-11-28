/** When to remind a user about their streak. Pure: the package sends no notifications (ADR 0002 §14, Apple 4.5.4). */
import type { StreakState } from './progress-models';

const HOUR = 3600 * 1000;

function quiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

/**
 * The instant to remind the user that today's streak is not done yet, or null when no reminder is needed. Schedule
 * your own local notification at this time, at most one a day, only for users who opted in.
 *
 * - [beforeMs] (3 h) before the server's `ends_today_at`.
 * - Null when today is done, there is no streak to lose, no deadline, or the time has passed at [now].
 * - Quiet hours [quietFromHour]:00–[quietToHour]:00 local time (wrapping midnight when from > to; none when equal). A
 *   time inside them moves earlier, to the last minute before they start (21:59 by default); if that is past, null.
 */
export function streakReminderAt(
  s: StreakState,
  opts: { now: Date; beforeMs?: number; quietFromHour?: number; quietToHour?: number },
): Date | null {
  const end = s.endsTodayAt;
  if (s.todayDone || s.current <= 0 || end == null) return null;
  const from = opts.quietFromHour ?? 22;
  const to = opts.quietToHour ?? 9;
  let at = new Date(end.getTime() - (opts.beforeMs ?? 3 * HOUR));
  if (quiet(at.getHours(), from, to)) {
    let start = new Date(at.getFullYear(), at.getMonth(), at.getDate(), from);
    if (start.getTime() > at.getTime()) start = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1, from);
    at = new Date(start.getTime() - 60 * 1000);
  }
  if (at.getTime() <= opts.now.getTime() || at.getTime() >= end.getTime()) return null;
  return at;
}
