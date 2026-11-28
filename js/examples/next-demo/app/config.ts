import type { InviteConfig } from '@myind/kit-next';

/** The demo site's address: set NEXT_PUBLIC_SITE_URL when it is served elsewhere than localhost:3000. */
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * The invite page config. No Supabase keys here: the demo never calls a real project, so the invite page shows the
 * plain version (add `supabaseUrl` + `anonKey`, never a service key, for the sharer's name and reward preview).
 */
export const inviteConfig: InviteConfig = {
  appName: 'Acme',
  appStoreUrl: 'https://apps.apple.com/app/id000000000',
  playPackage: 'com.example.acme',
  siteUrl,
  ogImageUrl: `${siteUrl}/og/invite?lang=en`,
  termsPath: '/terms',
  rewardLabels: { en: { chapters: { one: '{n} free chapter', other: '{n} free chapters' } } },
};
