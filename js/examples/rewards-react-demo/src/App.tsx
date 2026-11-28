/**
 * Every @myind/rewards-react component on the in-memory engine from `@myind/rewards-core/testing`. The buttons on
 * the left move the story on (a new day, a broken streak, the week closes, …) so every state can be seen. Nothing is
 * sent anywhere: this is a demo on a fake server.
 */
import { MysteryOdd, RewardGrant, RewardSpec, type Recap } from '@myind/rewards-core';
import { FakeRewardsServer, fakeRewards } from '@myind/rewards-core/testing';
import {
  ActivityHeatmap,
  Countdown,
  DailyGoalRing,
  FollowupSettings,
  FriendStreaks,
  LeagueBoard,
  MilestoneProgress,
  MyindAttribution,
  MysteryOdds,
  OfferBanner,
  QuestList,
  QuizCard,
  QuizScreen,
  RechargeMeter,
  RecapCard,
  RecapShareCard,
  recapYear,
  RewardedAdButton,
  RewardInbox,
  RewardReveal,
  RewardsHub,
  RewardsProvider,
  RewardToastListener,
  SocialTagTask,
  StreakCard,
  SurpriseOdds,
  WindowBadge,
} from '@myind/rewards-react';
import { useEffect, useState, type ReactNode } from 'react';

type Theme = 'system' | 'light' | 'dark';

function makeDemo() {
  const server = new FakeRewardsServer({ latencyMs: 250, seed: 7, surpriseChance: 0.3 });
  const { client, controller } = fakeRewards(server);
  return { server, client, controller };
}

const year = new Date().getFullYear();
const [yearFrom, yearTo] = recapYear(year);
const sampleSurprise = new RewardGrant({ id: 'demo-surprise', program: 'reader', kind: 'coins', amount: 23, params: { surprise: true, range: [5, 50] } });
const sampleMystery = new RewardSpec({
  kind: 'mystery',
  odds: [
    new MysteryOdd({ kind: 'coins', amount: 50, chance: 0.6 }),
    new MysteryOdd({ kind: 'streak_freeze', amount: 1, chance: 0.3 }),
    new MysteryOdd({ kind: 'entitlement_days', amount: 3, chance: 0.1 }),
  ],
});

function Section(props: { readonly title: string; readonly note?: string; readonly children: ReactNode; readonly wide?: boolean }): ReactNode {
  return (
    <section className={props.wide ? 'demo-section demo-section--wide' : 'demo-section'} aria-label={props.title}>
      <h2>{props.title}</h2>
      {props.note ? <p className="demo-note">{props.note}</p> : null}
      {props.children}
    </section>
  );
}

export function App(): ReactNode {
  const [demo] = useState(makeDemo);
  const { server, client, controller } = demo;
  const [theme, setTheme] = useState<Theme>('system');
  const [hold, setHold] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [revealKey, setRevealKey] = useState(0);
  const [deadline] = useState(() => new Date(Date.now() + 90 * 60 * 1000));

  useEffect(() => {
    void client.recap(yearFrom, yearTo).then(setRecap);
  }, [client]);

  const say = (line: string): void => setLog((l) => [line, ...l].slice(0, 6));
  const move = (label: string, f: () => void | Promise<unknown>) => async (): Promise<void> => {
    await f();
    await controller.refresh();
    say(label);
  };
  const flag = (label: string, get: () => boolean, set: (v: boolean) => void) => (
    <label className="demo-check">
      <input
        type="checkbox"
        defaultChecked={get()}
        onChange={(e) => {
          set(e.target.checked);
          void controller.refresh();
          say(`${label}: ${e.target.checked ? 'on' : 'off'}`);
        }}
      />
      {label}
    </label>
  );

  const showAd = async (): Promise<boolean> => {
    await new Promise((r) => setTimeout(r, 1200));
    server.inbox.unshift({ id: `ad${Date.now()}`, program: 'ads', kind: 'coins', amount: 10, params: {}, state: 'granted' });
    return true;
  };

  return (
    <div className="demo" data-theme={theme === 'system' ? undefined : theme}>
      <RewardsProvider controller={controller}>
        <RewardToastListener holdUntilMoment={hold}>
          <header className="demo-header">
            <p className="demo-badge">Demo — fake server</p>
            <h1>@myind/rewards-react</h1>
            <p>
              Every rewards component, driven by the in-memory engine from <code>@myind/rewards-core/testing</code>. Nothing leaves this page.
            </p>
          </header>
          <div className="demo-layout">
            <aside className="demo-panel" aria-label="Story moves">
              <h2>Story moves</h2>
              <div className="demo-buttons">
                <button onClick={move('Read a chapter (tracked)', () => controller.track('chapter_read'))}>Read a chapter</button>
                <button onClick={move('A new day', () => server.newDay())}>New day</button>
                <button onClick={move('Streak at risk', () => server.streakAtRisk())}>Streak at risk</button>
                <button onClick={move('Streak broke (repair offered)', () => server.breakStreak(20, 2))}>Break the streak</button>
                <button onClick={move('Offer expired', () => server.expireOffer())}>Expire the offer</button>
                <button onClick={move('Offer sold out', () => server.sellOutOffer())}>Sell out the offer</button>
                <button onClick={move('Post verified', () => server.verifySocial())}>Verify the post</button>
                <button onClick={move('Post rejected', () => server.rejectSocial())}>Reject the post</button>
                <button onClick={move('Friend did today', () => server.friendDoesToday())}>Friend does today</button>
                <button onClick={move('League week closed', async () => { server.closeLeagueWeek(2); await controller.loadLeague('weekly'); })}>Close the league week</button>
                <button onClick={move('Mystery reward granted', () => server.grantMystery())}>Grant a mystery</button>
                <button onClick={move('Premium on its way', () => server.grantPending())}>Grant a pending reward</button>
                <button onClick={move('Happy hour toggled', () => {
                  server.windowActive = !server.windowActive;
                })}>Toggle happy hour</button>
                <button
                  onClick={() => {
                    controller.celebrateNow();
                    say('celebrateNow()');
                  }}
                >
                  Celebrate now
                </button>
              </div>
              <h3>Switches</h3>
              {flag('Offline', () => server.offline, (v) => (server.offline = v))}
              {flag('Not deployed', () => !server.deployed, (v) => (server.deployed = !v))}
              {flag('Engine disabled', () => !server.enabled, (v) => (server.enabled = !v))}
              <label className="demo-check">
                <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />
                Hold toasts until “Celebrate now”
              </label>
              <h3>Theme</h3>
              <div className="demo-buttons demo-buttons--row" role="group" aria-label="Theme">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <h3>Last moves</h3>
              <ul className="demo-log" aria-live="polite">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </aside>

            <main className="demo-grid">
              <Section title="RewardsHub" note="Every live program in the server's order, inbox and odds on top, attribution at the bottom." wide>
                <RewardsHub onOpenInstagram={() => say('Open Instagram (the app decides how)')} onShareInvite={(c) => say(`Share invite ${c}`)} />
              </Section>
              <Section title="StreakCard + DailyGoalRing">
                <StreakCard />
                <div className="demo-row">
                  <DailyGoalRing />
                  <DailyGoalRing size={80} strokeWidth={8} />
                </div>
              </Section>
              <Section title="ActivityHeatmap">
                <ActivityHeatmap />
              </Section>
              <Section title="MilestoneProgress">
                <MilestoneProgress program="reader" title="Read 5 chapters" />
              </Section>
              <Section title="QuestList">
                <QuestList program="daily_quests" />
              </Section>
              <Section title="OfferBanner" note="Hidden once claimed, expired or sold out; the render prop sees every state.">
                <OfferBanner program="welcome" title="Welcome gift" />
                <OfferBanner program="welcome" render={(o) => <p className="demo-note">Offer state: {o.status}</p>} />
              </Section>
              <Section title="WindowBadge + RechargeMeter">
                <WindowBadge program="happy" />
                <RechargeMeter program="hearts" showUseButton />
              </Section>
              <Section title="FriendStreaks" note="Try code F1234567 to add a friend.">
                <FriendStreaks program="buddies" />
              </Section>
              <Section title="LeagueBoard">
                <LeagueBoard program="weekly" maxRows={4} />
              </Section>
              <Section title="SocialTagTask">
                <SocialTagTask program="ig" showLinkField onOpenInstagram={() => say('Open Instagram')} />
              </Section>
              <Section title="RewardInbox + SurpriseOdds">
                <RewardInbox showEmpty />
                <SurpriseOdds />
              </Section>
              <Section title="RewardReveal + MysteryOdds">
                <RewardReveal key={revealKey} grant={sampleSurprise} onEvent={(e) => say(e.name)} />
                <button className="demo-small" onClick={() => setRevealKey((k) => k + 1)}>
                  Close it again
                </button>
                <MysteryOdds reward={sampleMystery} />
              </Section>
              <Section title="RewardedAdButton" note="The ad is a fake adapter that waits 1.2 s and reports a verified reward.">
                <RewardedAdButton label="Watch an ad for 10 coins" onShowAd={showAd} />
              </Section>
              <Section title="QuizCard">
                <QuizCard program="quiz" />
              </Section>
              <Section title="QuizScreen" wide>
                <QuizScreen program="quiz" showAttribution={false} />
              </Section>
              <Section title="RecapCard">
                <RecapCard from={yearFrom} to={yearTo} />
              </Section>
              <Section title="RecapShareCard" note="Becomes a PNG only when you tap Download or Share.">
                {recap ? <RecapShareCard recap={recap} subtitle="Rewards demo" fileName={`recap-${year}.png`} /> : null}
              </Section>
              <Section title="FollowupSettings">
                <FollowupSettings showChoices />
              </Section>
              <Section title="Countdown + MyindAttribution">
                <Countdown endsAt={deadline} clock={controller.clock} prefix="Ends in" />
                <MyindAttribution variant={0} />
              </Section>
            </main>
          </div>
        </RewardToastListener>
      </RewardsProvider>
    </div>
  );
}
