// Port of packages/referral_kit/test/support/fake_rpc.dart: JSON shapes exactly as the SQL builds them.
import { FixedInstallIdStore, ReferralClient, type ReferralClientOptions } from '../src';

export function termsJson(
  o: { enabled?: boolean; paidEnabled?: boolean; friendRule?: boolean; sharerJoinedRule?: boolean; paidRule?: boolean } = {},
): Record<string, unknown> {
  const { enabled = true, paidEnabled = true, friendRule = true, sharerJoinedRule = true, paidRule = true } = o;
  return {
    enabled,
    paid_enabled: paidEnabled,
    rule_set_version: 1,
    rules: [
      ...(friendRule ? [{ event: 'joined', who: 'friend', kind: 'minutes', amount: 30, params: {} }] : []),
      ...(sharerJoinedRule ? [{ event: 'joined', who: 'sharer', kind: 'minutes', amount: 30, params: {} }] : []),
      ...(paidRule
        ? [{ event: 'paid', who: 'sharer', kind: 'entitlement_days', amount: 5, params: { entitlement_id: 'premium' } }]
        : []),
    ],
    claim_window_days: 7,
    activate_window_days: 30,
    paid_window_days: 90,
    hold_hours: 72,
    sharer_joins_per_30d: 10,
    sharer_paid_per_365d: 6,
  };
}

export const statsJson = (empty = false): Record<string, unknown> =>
  empty
    ? { rewards_granted: [], pending: [], banked: [], skipped_cap: 0, joined_count: null, paid_count: null }
    : {
        rewards_granted: [
          {
            id: '0b9a3f4e-1111-4c2d-9a51-000000000001',
            who: 'sharer',
            event: 'joined',
            kind: 'minutes',
            amount: 30,
            at: '2026-11-10T08:15:30.123456+00:00',
          },
        ],
        pending: [
          {
            id: '0b9a3f4e-1111-4c2d-9a51-000000000002',
            event: 'paid',
            kind: 'entitlement_days',
            amount: 5,
            available_at: '2026-11-15T09:00:00+00:00',
          },
        ],
        banked: [{ id: '0b9a3f4e-1111-4c2d-9a51-000000000003', kind: 'entitlement_days', amount: 5 }],
        skipped_cap: 2,
        joined_count: 4,
        paid_count: 1,
      };

export const pendingJson = (): unknown[] => [
  { id: '0b9a3f4e-1111-4c2d-9a51-000000000004', who: 'friend', event: 'joined', kind: 'minutes', amount: 30, state: 'granted', params: null },
  {
    id: '0b9a3f4e-1111-4c2d-9a51-000000000005',
    who: 'sharer',
    event: 'paid',
    kind: 'entitlement_days',
    amount: 5,
    state: 'banked',
    params: { entitlement_id: 'premium' },
  },
];

type Answer = unknown | ((params: Record<string, unknown>) => unknown);

/** Records every call and answers from [responses] (a value, or a function of the params). Throws [error] when set. */
export class FakeRpc {
  readonly responses: Record<string, Answer>;
  readonly calls: Array<[string, Record<string, unknown>]> = [];
  error: unknown = null;

  constructor(responses: Record<string, Answer> = {}) {
    this.responses = {
      referral_my_code: { code: 'ABCDEFGH', reason: 'ok' },
      referral_terms: termsJson(),
      referral_stats: statsJson(),
      referral_pending: pendingJson(),
      referral_ack: { acknowledged: 1 },
      referral_claim: { reason: 'ok', days_left: 30 },
      referral_check_activation: { state: 'joined' },
      referral_rotate_code: { code: 'ABCDEFGH', reason: 'too_soon', next_allowed_at: '2026-12-01T00:00:00+00:00' },
      ...responses,
    };
  }

  readonly call = async (fn: string, params: Record<string, unknown>): Promise<unknown> => {
    this.calls.push([fn, params]);
    if (this.error != null) throw this.error;
    const r = this.responses[fn];
    return typeof r === 'function' ? (r as (p: Record<string, unknown>) => unknown)(params) : r;
  };

  get names(): string[] {
    return this.calls.map((c) => c[0]);
  }
}

export const testInstallId = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';

export const clientFor = (rpc: FakeRpc, opts: Partial<ReferralClientOptions> = {}): ReferralClient =>
  new ReferralClient({ rpc: rpc.call, installIds: new FixedInstallIdStore(testInstallId), ...opts });
