// Port of packages/rewards_kit/test/followup_client_test.dart, followup_groups_test.dart (models and client) and
// followup_scheduler_test.dart (with fake timers instead of testWidgets' pump).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FollowupGroup,
  followupIdStoreOn,
  followupOpenedKey,
  FollowupPrefs,
  FollowupScheduler,
  MemoryFollowupIdStore,
  parseMutedGroups,
  RewardsClient,
  RewardsEventName,
  type FollowupNotifier,
  type RewardsEvent,
} from '../src';
import { controllerOn, FakeRpc, MIN, HOUR, planItem, planJson, plus, sampleState, serverNow, type Json } from './fakes';

describe('follow-up client (0.4)', () => {
  it('exact function and parameter names (ADR 0002 §18.7)', async () => {
    const events: RewardsEvent[] = [];
    const rpc = new FakeRpc({
      rewards_followups_plan: () => planJson([planItem(1, 2)]),
      rewards_followup_prefs: () => ({ notifications_off: false, emails_off: true, reminder_time: '08:00:00' }),
    });
    const c = new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) });
    expect((await c.followupsPlan()).items[0]!.id).toBe(1);
    await c.followupsPlan(3);
    expect((await c.followupPrefs()).emailsOff).toBe(true);
    const p = await c.followupPrefs({ notifications_off: true, reminder_time: { hour: 8, minute: 0 }, secret_key: 'x' });
    expect(p.reminderTime).toEqual({ hour: 8, minute: 0 });
    await c.followupPrefs({ reminder_time: '21:30:00' });
    await c.followupPrefs({ reminder_time: null });
    expect(rpc.calls).toEqual([
      ['rewards_followups_plan', { days: 14 }],
      ['rewards_followups_plan', { days: 3 }],
      ['rewards_followup_prefs', { patch: {} }],
      ['rewards_followup_prefs', { patch: { notifications_off: true, reminder_time: '08:00' } }],
      ['rewards_followup_prefs', { patch: { reminder_time: '21:30' } }],
      ['rewards_followup_prefs', { patch: { reminder_time: null } }],
    ]);
    expect(events.filter((e) => e.name === RewardsEventName.followupPrefsChanged).map((e) => e.props['field'])).toEqual([
      'notifications_off',
      'reminder_time',
      'reminder_time',
      'reminder_time',
    ]);
    expect(events.map(String).join()).not.toContain('08:00');
  });

  it('trackFollowupOpened: followup_opened, "<program>:<local day>", props {program}', async () => {
    const events: RewardsEvent[] = [];
    const rpc = new FakeRpc({ rewards_track: () => ({ duplicate: false }) });
    const c = new RewardsClient({ rpc: rpc.call, timezone: () => 'Asia/Kolkata', onEvent: (e) => events.push(e) });
    await c.trackFollowupOpened('inactive2', new Date(2026, 10, 14, 23, 59));
    expect(rpc.called('rewards_track')[0]).toEqual({
      type: 'followup_opened',
      dedupe_key: 'inactive2:2026-11-14',
      props: { program: 'inactive2' },
      timezone: 'Asia/Kolkata',
    });
    expect(followupOpenedKey('p', new Date(2026, 0, 2, 0, 1))).toBe('p:2026-01-02');
    expect(events.at(-1)!.name).toBe(RewardsEventName.followupOpened);
    expect(events.at(-1)!.props).toEqual({ program: 'inactive2' });
  });

  it('controller.followupOpened tracks with the day key, then reloads; a failure is a reason', async () => {
    const rpc = new FakeRpc({ rewards_track: () => ({ duplicate: false }), rewards_state: () => sampleState() });
    const c = controllerOn(rpc);
    expect(await c.followupOpened('streak_risk', new Date(2026, 10, 14, 9))).toBeNull();
    expect(rpc.called('rewards_track')[0]!['dedupe_key']).toBe('streak_risk:2026-11-14');
    expect(rpc.calls.at(-1)![0]).toBe('rewards_state');
    expect(c.loaded).toBe(true);
    const down = controllerOn(
      new FakeRpc({
        rewards_track: () => {
          throw new Error('socket closed');
        },
      }),
    );
    expect(await down.followupOpened('streak_risk')).toBe('offline');
  });
});

describe('follow-up groups (0.5)', () => {
  it('muted_groups and groups are read', () => {
    const p = FollowupPrefs.fromJson({
      muted_groups: ['recap'],
      groups: [
        { group: 'daily', label: 'Comeback reminders', muted: false },
        { group: 'recap', label: 'Sunday recap', muted: true },
      ],
    });
    expect([...p.mutedGroups]).toEqual(['recap']);
    expect(p.groups).toEqual([new FollowupGroup('daily', 'Comeback reminders', false), new FollowupGroup('recap', 'Sunday recap', true)]);
  });

  it('missing or bad values are empty; bad items skipped; label falls back to the group name', () => {
    expect(FollowupPrefs.fromJson({}).equals(new FollowupPrefs())).toBe(true);
    expect(FollowupPrefs.fromJson({ muted_groups: 'recap', groups: 'x' }).equals(new FollowupPrefs())).toBe(true);
    const p = FollowupPrefs.fromJson({
      muted_groups: ['recap', 7, null, '', '  ', ' daily ', 'recap'],
      groups: [
        'not an object',
        { label: 'No name' },
        { group: '  ', label: 'Blank' },
        { group: 'daily', label: null, muted: 'true' },
        { group: 'daily', label: 'Duplicate' },
        { group: 'recap', label: '', muted: 1 },
      ],
    });
    expect(new Set(p.mutedGroups)).toEqual(new Set(['recap', 'daily']));
    expect(p.groups).toEqual([new FollowupGroup('daily', 'daily', true), new FollowupGroup('recap', 'recap', false)]);
    expect(parseMutedGroups(null).size).toBe(0);
  });

  it('groupMutedPatch adds or removes one name; patched updates every group', () => {
    const p = new FollowupPrefs({
      mutedGroups: new Set(['recap']),
      groups: [new FollowupGroup('daily', 'Daily', false), new FollowupGroup('recap', 'Recap', true)],
    });
    expect(p.groupMutedPatch('daily', true)).toEqual({ muted_groups: ['recap', 'daily'] });
    expect(p.groupMutedPatch('recap', false)).toEqual({ muted_groups: [] });
    expect(p.groupMutedPatch('recap', true)).toEqual({ muted_groups: ['recap'] });
    const q = p.patched(p.groupMutedPatch('daily', true));
    expect(new Set(q.mutedGroups)).toEqual(new Set(['recap', 'daily']));
    expect(q.groups.map((g) => g.muted)).toEqual([true, true]);
    expect([...p.patched({ emails_off: true }).mutedGroups]).toEqual(['recap']);
  });

  describe('client', () => {
    let rpc: FakeRpc;
    let server: Json;
    let events: RewardsEvent[];
    let c: RewardsClient;
    beforeEach(() => {
      server = { notifications_off: false, muted_groups: ['recap'] };
      events = [];
      rpc = new FakeRpc({
        rewards_followup_prefs: (p) => {
          Object.assign(server, p['patch'] as Json);
          return { ...server };
        },
      });
      c = new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) });
    });
    const patches = (): unknown[] => rpc.called('rewards_followup_prefs').map((p) => p['patch']);

    it('followupPrefs sends muted_groups as a list of names; not a list is left out', async () => {
      await c.followupPrefs({ muted_groups: new Set(['daily', 7, '']) });
      await c.followupPrefs({ muted_groups: 'daily', emails_off: true });
      await c.followupPrefs({ muted_groups: null });
      expect(patches()).toEqual([{ muted_groups: ['daily'] }, { emails_off: true }, {}]);
      expect(events.map((e) => e.props)).toEqual([{ field: 'muted_groups' }, { field: 'emails_off' }]);
    });

    it('setFollowupGroupMuted reads first, then sends the list from the last known prefs', async () => {
      expect(c.lastFollowupPrefs).toBeNull();
      const p = await c.setFollowupGroupMuted('daily', true);
      expect(new Set(p.mutedGroups)).toEqual(new Set(['recap', 'daily']));
      expect(c.lastFollowupPrefs).toBe(p);
      await c.setFollowupGroupMuted('recap', false);
      expect(patches()).toEqual([{}, { muted_groups: ['recap', 'daily'] }, { muted_groups: ['daily'] }]);
      expect(events.map((e) => e.props)).toEqual([
        { field: 'muted_groups', group: 'daily' },
        { field: 'muted_groups', group: 'recap' },
      ]);
    });
  });
});

/** Records what the scheduler asked of the device; throws on schedule / cancel when told to. */
class FakeNotifier implements FollowupNotifier {
  readonly scheduled: Array<[number, Date, string, string, string]> = [];
  readonly cancelled: number[][] = [];
  failSchedule = false;
  failCancel = false;
  async cancel(ids: number[]): Promise<void> {
    if (this.failCancel) throw new Error('plugin down');
    this.cancelled.push(ids);
  }
  async schedule(n: { id: number; at: Date; title: string; body: string; payload: string }): Promise<void> {
    if (this.failSchedule) throw new Error('plugin down');
    this.scheduled.push([n.id, n.at, n.title, n.body, n.payload]);
  }
  get scheduledIds(): number[] {
    return this.scheduled.map((s) => s[0]);
  }
}

describe('FollowupScheduler', () => {
  let rpc: FakeRpc;
  let notifier: FakeNotifier;
  let store: MemoryFollowupIdStore;
  let events: RewardsEvent[];
  let plan: Json[];
  const make = (local?: () => Date): FollowupScheduler =>
    new FollowupScheduler({ controller: controllerOn(rpc, { events, ...(local ? { local } : {}) }), notifier, store });
  const plans = (): number => rpc.called('rewards_followups_plan').length;
  const failures = (): unknown[] => events.filter((e) => e.name === RewardsEventName.followupsFailed).map((e) => e.props['reason']);

  beforeEach(() => {
    vi.useFakeTimers();
    plan = [planItem(1, -1), planItem(2, 3), planItem(3, 27)];
    rpc = new FakeRpc({ rewards_followups_plan: () => planJson(plan), rewards_state: () => sampleState(), rewards_track: () => ({ duplicate: false }) });
    notifier = new FakeNotifier();
    store = new MemoryFollowupIdStore();
    events = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the constructor starts nothing', async () => {
    make();
    await vi.advanceTimersByTimeAsync(10000);
    expect(rpc.calls).toHaveLength(0);
    expect(notifier.scheduled).toHaveLength(0);
    expect(notifier.cancelled).toHaveLength(0);
  });

  it('start plans after the debounce; past items are skipped; ids remembered', async () => {
    const s = make();
    s.start();
    await vi.advanceTimersByTimeAsync(1900);
    expect(plans()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(plans()).toBe(1);
    expect(rpc.called('rewards_followups_plan')[0]).toEqual({ days: 14 });
    expect(notifier.scheduledIds).toEqual([2, 3]);
    const first = notifier.scheduled[0]!;
    expect(first[1]).toEqual(plus(serverNow, 3 * HOUR));
    expect([first[2], first[3], first[4]]).toEqual(['App', 'Your next step is still here.', '/app/home']);
    expect(store.ids).toEqual([2, 3]);
    expect(events.at(-1)!.name).toBe(RewardsEventName.followupsPlanned);
    expect(events.at(-1)!.props).toEqual({ count: 2 });
    await s.stop();
  });

  it('controller changes are debounced into one replan', async () => {
    const s = make();
    s.start();
    for (let i = 0; i < 4; i++) {
      await s.controller.refresh();
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(plans()).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(plans()).toBe(1);
    await s.controller.track('chapter_read');
    await vi.advanceTimersByTimeAsync(3000);
    expect(plans()).toBe(2);
    await s.stop();
  });

  it('ids no longer planned are cancelled; kept ones are scheduled again', async () => {
    await store.write([2, 99, 1]);
    const s = make();
    await s.replanNow();
    expect(notifier.cancelled).toEqual([[99, 1]]);
    expect(notifier.scheduledIds).toEqual([2, 3]);
    plan = [planItem(3, 27), planItem(4, 50)];
    await s.replanNow();
    expect(notifier.cancelled.at(-1)).toEqual([2]);
    expect(notifier.scheduledIds.slice(2)).toEqual([3, 4]);
    expect(store.ids).toEqual([3, 4]);
  });

  it('a wrong device clock: times move onto the device clock, "past" uses the server time', async () => {
    const s = make(() => plus(serverNow, -10 * MIN));
    plan = [planItem(1, -0.1), planItem(2, 1)];
    await s.replanNow();
    expect(notifier.scheduledIds).toEqual([2]);
    expect(notifier.scheduled[0]![1]).toEqual(plus(serverNow, 50 * MIN));
  });

  it('stop cancels everything it scheduled and stops listening', async () => {
    const s = make();
    s.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.started).toBe(true);
    await s.stop();
    expect(s.started).toBe(false);
    expect(notifier.cancelled.at(-1)).toEqual([2, 3]);
    expect(store.ids).toEqual([]);
    await s.controller.refresh();
    await vi.advanceTimersByTimeAsync(5000);
    expect(plans()).toBe(1);
  });

  it('stop before the debounce fires: no plan is fetched', async () => {
    const s = make();
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    await s.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(plans()).toBe(0);
  });

  it('errors are swallowed and reported with a reason, never a message', async () => {
    rpc.handlers['rewards_followups_plan'] = () => {
      throw new Error('socket closed at 10.0.0.1');
    };
    const s = make();
    await s.replanNow();
    rpc.handlers['rewards_followups_plan'] = () => {
      throw new Error('rewards: not_signed_in');
    };
    await s.replanNow();
    rpc.handlers['rewards_followups_plan'] = () => planJson(plan);
    notifier.failSchedule = true;
    await s.replanNow();
    expect(store.ids).toEqual([2, 3]);
    notifier.failCancel = true;
    await s.stop();
    expect(failures()).toEqual(['offline', 'unavailable', 'notifier_error', 'notifier_error']);
    expect(events.map(String).join()).not.toContain('socket');
  });

  it('a replan asked for while one runs runs once more afterwards', async () => {
    const s = make();
    await Promise.all([s.replanNow(), s.replanNow()]);
    expect(plans()).toBe(2);
  });

  it('followupIdStoreOn persists ids as JSON in a string store', async () => {
    const map = new Map<string, string>();
    const kv = { getString: async (k: string) => map.get(k) ?? null, setString: async (k: string, v: string) => void map.set(k, v) };
    const ids = followupIdStoreOn(kv);
    expect(await ids.read()).toEqual([]);
    await ids.write([3, 4]);
    expect(map.get('rewards_kit.followup_ids')).toBe('[3,4]');
    expect(await followupIdStoreOn(kv).read()).toEqual([3, 4]);
    map.set('rewards_kit.followup_ids', 'junk');
    expect(await ids.read()).toEqual([]);
  });
});
