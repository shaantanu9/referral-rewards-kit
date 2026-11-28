// Port of packages/referral_kit/test/support/growth_json.dart.
export const boostJson = (
  o: { startsAt?: string; endsAt?: string; multiplier?: number; who?: string[] } = {},
): Record<string, unknown> => ({
  starts_at: o.startsAt ?? '2026-11-17T00:00:00+00:00',
  ends_at: o.endsAt ?? '2026-11-24T00:00:00+00:00',
  multiplier: o.multiplier ?? 2,
  events: ['joined'],
  who: o.who ?? ['sharer', 'friend'],
});

export const prefsJson = { show_name: false, display_name: null, participating: true };
export const myClaimNone = { state: 'none' };
export const myClaimClaimed = {
  state: 'claimed',
  claimed_at: '2026-11-20T08:00:00+00:00',
  activate_by: '2026-12-02T08:00:00+00:00',
  days_left: 12,
  rewards: [{ kind: 'minutes', amount: 60, base_amount: 30, params: {}, boosted: true }],
};
export const myClaimJoined = { state: 'joined', joined_at: '2026-11-21T09:30:00+00:00' };
export const myClaimExpired = { state: 'expired' };
