'use client';
// Every @myind/referral-react component on a FAKE referral server (@myind/referral-core/testing): no Supabase, no
// real users, nothing sent anywhere. Each card has its own fake server set to one state.
import { MemoryKeyValueStore, type ReferralClient } from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import {
  InviteCodeEntry,
  InviteCodeSection,
  InviteCodeText,
  InviteFriendsScreen,
  InviteHub,
  MyindAttribution,
  ReferralBoostBanner,
  ReferralDeadlineChip,
  ReferralInvitePageSettings,
  ReferralMessage,
  ReferralProvider,
  ReferralQrCode,
  ReferralRewardCard,
  ReferralWelcomeCard,
  useReferralTerms,
  type InviteHubHandle,
} from '@myind/referral-react';
import { useRef, useState, type ReactNode } from 'react';
import { siteUrl } from './config';

const inviteLink = (code: string): string => `${siteUrl.startsWith('https:') ? siteUrl : 'https://acme.example'}/i/${code}`;
const labels = { byKind: { chapters: (n: number) => `${n} free chapters` }, entitlementNames: { plus: 'Plus' } };

function useFake(setup?: (s: FakeReferralServer) => void): { server: FakeReferralServer; client: ReferralClient } {
  const [v] = useState(() => {
    const server = new FakeReferralServer({ latencyMs: 250 });
    setup?.(server);
    return { server, client: fakeReferralClient(server, { onEvent: (e) => console.debug('[referral event]', e.name, e.props) }) };
  });
  return v;
}

function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? 'demo-card demo-card--wide' : 'demo-card'} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Fake({
  setup,
  locale,
  children,
}: {
  setup?: (s: FakeReferralServer) => void;
  locale: string;
  children: ReactNode;
}) {
  const { client } = useFake(setup);
  const [store] = useState(() => new MemoryKeyValueStore());
  return (
    <ReferralProvider
      client={client}
      store={store}
      appName="Acme"
      locale={locale}
      labels={labels}
      inviteLink={inviteLink}
      storeLink="https://acme.example/get"
      onSignIn={() => alert('Your app opens its sign-in here.')}
      attributionSource="next-demo"
    >
      {children}
    </ReferralProvider>
  );
}

function Primitives() {
  const terms = useReferralTerms();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <InviteCodeText code={FakeReferralServer.myCode} />
      {terms.value ? <ReferralBoostBanner terms={terms.value} /> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ReferralDeadlineChip text="Only 3 days left to add a code" />
        <ReferralDeadlineChip text="Last day to add a code" lastDay />
      </div>
      <div style={{ alignSelf: 'center', background: '#fff', borderRadius: 12 }}>
        <ReferralQrCode value={inviteLink(FakeReferralServer.myCode)} size={160} />
      </div>
      <ReferralMessage text="A plain message with an action." action="Try again" onAction={() => undefined} />
      {[0, 1, 2, 3].map((v) => (
        <MyindAttribution key={v} variant={v} source="next-demo" />
      ))}
    </div>
  );
}

export function Demo() {
  const [locale, setLocale] = useState('en');
  const [round, setRound] = useState(0);
  const hub = useRef<InviteHubHandle>(null);
  const main = useFake();
  const [mainStore] = useState(() => new MemoryKeyValueStore());
  const story = (f: (s: FakeReferralServer) => void) => () => {
    f(main.server);
    setRound((r) => r + 1);
  };
  const setTheme = (t: 'light' | 'dark' | null) => {
    if (t) document.documentElement.dataset['theme'] = t;
    else delete document.documentElement.dataset['theme'];
  };

  return (
    <div className="demo">
      <div className="demo-banner" role="note">
        <span>
          Demo — fake server <small>(@myind/referral-core/testing: no Supabase, nothing is sent)</small>
        </span>
        <div className="demo-controls">
          <label>
            Language{' '}
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </label>
          <button onClick={() => setTheme('light')}>Light</button>
          <button onClick={() => setTheme('dark')}>Dark</button>
          <button onClick={() => setTheme(null)}>System</button>
        </div>
      </div>

      <div className="demo-controls" aria-label="Story controls for the hub">
        <button onClick={story((s) => s.aFriendSignsUp())}>A friend signs up with your code</button>
        <button onClick={story((s) => s.aFriendStarts())}>A friend starts using the app</button>
        <button onClick={story((s) => s.aFriendPays())}>A friend subscribes</button>
        <button onClick={story((s) => (s.offline = !s.offline))}>Toggle offline</button>
        <button onClick={() => hub.current?.scrollTo('enterCode')}>Scroll to “Have an invite code?”</button>
      </div>

      <div className="demo-grid">
        <Card title="InviteHub (both parts, attribution once)" wide>
          <ReferralProvider
            key={`${round}-${locale}`}
            client={main.client}
            store={mainStore}
            appName="Acme"
            locale={locale}
            labels={labels}
            inviteLink={inviteLink}
            attributionSource="next-demo"
            texts={{ activationStep: 'Read your first page', activationStepForFriends: 'Read their first page' }}
          >
            <InviteHub ref={hub} from="demo" onOpenTerms={() => window.open('/terms', '_blank', 'noopener')} />
          </ReferralProvider>
        </Card>

        <Card title="InviteFriendsScreen: paused program">
          <Fake locale={locale} setup={(s) => (s.enabled = false)}>
            <InviteFriendsScreen />
          </Fake>
        </Card>
        <Card title="InviteFriendsScreen: no invite page (store link)">
          <Fake locale={locale}>
            <InviteFriendsScreen inviteLink={null} showAttribution={false} />
          </Fake>
        </Card>
        <Card title="InviteFriendsScreen: not deployed">
          <Fake locale={locale} setup={(s) => (s.deployed = false)}>
            <InviteFriendsScreen />
          </Fake>
        </Card>
        <Card title="InviteFriendsScreen: signed out">
          <Fake locale={locale} setup={(s) => (s.signedIn = false)}>
            <InviteFriendsScreen />
          </Fake>
        </Card>
        <Card title="InviteFriendsScreen: left the program">
          <Fake locale={locale} setup={(s) => (s.left = true)}>
            <InviteFriendsScreen />
          </Fake>
        </Card>
        <Card title="InviteCodeSection: last day">
          <Fake locale={locale} setup={(s) => (s.claimDaysLeft = 1)}>
            <InviteCodeSection onAlmostAction={() => undefined} />
          </Fake>
        </Card>
        <Card title="InviteCodeSection: window over">
          <Fake locale={locale} setup={(s) => (s.claimDaysLeft = 0)}>
            <InviteCodeSection />
          </Fake>
        </Card>
        <Card title={`InviteCodeEntry: code from a link (${FakeReferralServer.friendCode})`}>
          <Fake locale={locale}>
            <InviteCodeEntry initialCode={FakeReferralServer.friendCode} />
          </Fake>
        </Card>
        <Card title="InviteCodeEntry: rate limited (any code)">
          <Fake locale={locale} setup={(s) => (s.claimReason = 'rate_limited')}>
            <InviteCodeEntry />
          </Fake>
        </Card>
        <Card title="ReferralInvitePageSettings">
          <Fake locale={locale}>
            <ReferralInvitePageSettings />
          </Fake>
        </Card>
        <Card title="ReferralRewardCard (two rewards landed)">
          <Fake
            locale={locale}
            setup={(s) => {
              s.aFriendSignsUp();
              s.aFriendStarts();
              s.aFriendPays();
            }}
          >
            <ReferralRewardCard actionLabel="Read now" onAction={() => undefined} />
          </Fake>
        </Card>
        <Card title="ReferralWelcomeCard: claimed">
          <Fake locale={locale} setup={(s) => (s.claimed = true)}>
            <ReferralWelcomeCard activationStep="Read your first page" session="demo" />
          </Fake>
        </Card>
        <Card title="ReferralWelcomeCard: joined (pass it on)">
          <Fake
            locale={locale}
            setup={(s) => {
              s.claimed = true;
              s.youStartUsing();
            }}
          >
            <ReferralWelcomeCard session="demo" onPassItOn={() => hub.current?.scrollTo('invite')} />
          </Fake>
        </Card>
        <Card title="Code text, boost, chips, QR, message, attribution variants">
          <Fake locale={locale}>
            <Primitives />
          </Fake>
        </Card>
        <Card title="Next.js routes (@myind/kit-next)">
          <ul>
            <li>
              <a href={`/i/${FakeReferralServer.myCode}`}>/i/{FakeReferralServer.myCode}</a>: invite landing (route
              handler)
            </li>
            <li>
              <a href="/i/not-a-code">/i/not-a-code</a>: the “link is not complete” page
            </li>
            <li>
              <a href={`/join/${FakeReferralServer.myCode}`}>/join/{FakeReferralServer.myCode}</a>: the same as a React
              page with inviteMetadata
            </li>
            <li>
              <a href="/og/invite?lang=en">/og/invite</a> and <a href="/og/invite?lang=hi">?lang=hi</a>: OG image
            </li>
            <li>
              <a href="/terms">/terms</a>: program terms
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
