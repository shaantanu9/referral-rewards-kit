// The program terms page, generated from the rules (here the fake server's; in an app, the live referral_terms()).
import { createTermsRoute } from '@myind/kit-next';

export const { GET } = createTermsRoute({
  config: { appName: 'Acme' },
  terms: {
    enabled: true,
    paid_enabled: true,
    rules: [
      { event: 'joined', who: 'friend', kind: 'chapters', amount: 4 },
      { event: 'joined', who: 'sharer', kind: 'chapters', amount: 4 },
      { event: 'paid', who: 'sharer', kind: 'entitlement_days', amount: 5, params: { entitlement_id: 'plus' } },
    ],
    claim_window_days: 7,
    activate_window_days: 30,
    paid_window_days: 90,
    hold_hours: 72,
    sharer_joins_per_30d: 10,
    sharer_paid_per_365d: 6,
  },
  labels: { chapters: (n) => `${n} free chapters`, entitlement_days: (n) => `${n} days of Plus` },
});
