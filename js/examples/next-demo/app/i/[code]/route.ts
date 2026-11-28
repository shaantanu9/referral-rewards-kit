// The invite landing a shared link opens: /i/<CODE>. Server-rendered (the code shows with JavaScript off),
// noindex, store buttons, terms link. See @myind/kit-next createInviteRoute.
import { createInviteRoute } from '@myind/kit-next';
import { inviteConfig } from '../../config';

export const { GET } = createInviteRoute({ config: inviteConfig });
