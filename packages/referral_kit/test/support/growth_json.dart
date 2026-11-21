/// JSON of the 0.5 RPCs (migration 23), written from the design's contract
/// (migration 23, `supabase/migrations/20261120000023_referral_growth.sql`). The real SQL output lives in
/// `test/fixtures/growth/*.json` once the server side writes it; `growth_models_test.dart` parses both.
library;

Map<String, Object?> boostJson({
  String startsAt = '2026-11-17T00:00:00+00:00',
  String endsAt = '2026-11-24T00:00:00+00:00',
  num multiplier = 2,
  List<String> who = const ['sharer', 'friend'],
}) => {
  'starts_at': startsAt,
  'ends_at': endsAt,
  'multiplier': multiplier,
  'events': ['joined'],
  'who': who,
};

const prefsJson = {'show_name': false, 'display_name': null, 'participating': true};

const myClaimNone = {'state': 'none'};

const myClaimClaimed = {
  'state': 'claimed',
  'claimed_at': '2026-11-20T08:00:00+00:00',
  'activate_by': '2026-12-02T08:00:00+00:00',
  'days_left': 12,
  'rewards': [
    {'kind': 'minutes', 'amount': 60, 'base_amount': 30, 'params': {}, 'boosted': true},
  ],
};

const myClaimJoined = {'state': 'joined', 'joined_at': '2026-11-21T09:30:00+00:00'};

const myClaimExpired = {'state': 'expired'};
