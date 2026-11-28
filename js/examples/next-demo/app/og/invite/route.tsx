// The invite link's preview image (og:image, 1200×630): one per app and language, never per code or name.
import { createInviteOgRoute } from '@myind/kit-next/og';

export const { GET } = createInviteOgRoute({
  appName: 'Acme',
  accent: '#6750a4',
  texts: {
    hi: { headline: 'आपको Acme पर बुलाया गया है', subline: 'साइन अप करते समय दोस्त का कोड डालें' },
  },
});
