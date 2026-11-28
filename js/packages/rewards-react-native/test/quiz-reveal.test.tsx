import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { QuizController, RewardGrant, RewardsEventName } from '@myind/rewards-core';
import { FollowupSettings, QuizCard, QuizScreen, RewardedAdButton, RewardReveal, RewardRevealModal, RewardToastListener } from '../src';
import { setup, x } from './helpers';

const grant = (params: Record<string, unknown>, id = 'g1'): RewardGrant =>
  RewardGrant.fromJson({ id, program: 'reader', kind: 'coins', amount: 23, params, state: 'granted' });

describe('quiz', () => {
  test('QuizCard: rules and Start open the app route; in progress Resume; render replaces the look', async () => {
    const s = setup();
    const opened: string[] = [];
    await render(s.wrap(<QuizCard controller={s.controller} program="quiz" onOpen={(p) => opened.push(p)} />));
    expect(await screen.findByText(x.quiz.rules(4))).toBeOnTheScreen();
    expect(screen.getByText(/^New quiz in/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.quiz.start }));
    expect(opened).toEqual(['quiz']);
    await screen.unmount();
    s.server.quiz.status = 'in_progress';
    await act(() => s.controller.refresh());
    await render(s.wrap(<QuizCard controller={s.controller} program="quiz" render={(q) => <Text>{`q ${q.status}`}</Text>} />));
    expect(await screen.findByText('q in_progress')).toBeOnTheScreen();
  });

  test('default flow: rules → question → reveal → … → score; true/false without choices shows True and False', async () => {
    const s = setup();
    const quiz = new QuizController({ client: s.client, program: 'quiz', rewards: s.controller, revealForMs: null });
    await render(s.wrap(<QuizScreen controller={s.controller} program="quiz" quiz={quiz} />));
    await fireEvent.press(await screen.findByRole('button', { name: x.quiz.start }));
    expect(await screen.findByText('Which planet is called the red planet?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Mars' }));
    expect(await screen.findByText(x.quiz.right)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.quiz.next }));
    expect(await screen.findByText('The Pacific is the largest ocean.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'False' }));
    expect(await screen.findByText(x.quiz.wrong)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.quiz.next }));
    expect(await screen.findByText(x.quiz.oddOneOut)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Rose' }));
    await fireEvent.press(await screen.findByRole('button', { name: x.quiz.next }));
    expect(await screen.findByRole('button', { name: x.quiz.trueLabel })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.quiz.falseLabel }));
    await fireEvent.press(await screen.findByRole('button', { name: x.quiz.next }));
    expect(await screen.findByText(x.quiz.score(3, 4))).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Opens myind.ai: Rewards by Myind' })).toBeOnTheScreen();
    quiz.dispose();
  });

  test('offline shows Retry; showAttribution false hides the link; the screen makes its own controller', async () => {
    const s = setup();
    s.server.offline = true;
    await render(s.wrap(<QuizScreen controller={s.controller} program="quiz" showAttribution={false} />));
    expect(await screen.findByRole('button', { name: x.quiz.retry })).toBeOnTheScreen();
    expect(screen.queryByTestId('myind-attribution')).toBeNull();
    s.server.offline = false;
    await fireEvent.press(screen.getByRole('button', { name: x.quiz.retry }));
    expect(await screen.findByRole('button', { name: x.quiz.start })).toBeOnTheScreen();
  });
});

describe('reveal', () => {
  test('closed → Open → opened; haptic; onOpened and the event once; no near miss', async () => {
    const events: string[] = [];
    const opened = jest.fn();
    const haptic = jest.fn();
    await render(
      <RewardReveal grant={grant({ surprise: true, range: [5, 50] })} onOpened={opened} onHaptic={haptic} onEvent={(e) => events.push(e.name)} />,
    );
    expect(screen.getByText(x.reveal.title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reward-reveal-open'));
    expect(await screen.findByText(x.reveal.youGot('23 coins'))).toBeOnTheScreen();
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(events).toEqual([RewardsEventName.revealOpened]);
    expect(screen.queryByText(/50/)).toBeNull();
  });

  test('reduced motion opens at once; a fixed grant shows plainly; render still fires once', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<RewardReveal grant={grant({ surprise: true })} />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('reward-reveal-open'));
    expect(screen.getByTestId('reward-reveal-opened')).toBeOnTheScreen();
    await screen.unmount();
    const opened = jest.fn();
    await render(<RewardReveal grant={grant({ range: [5, 50], fixed: true })} onOpened={opened} />);
    expect(screen.getByTestId('reward-reveal-opened')).toBeOnTheScreen();
    await act(async () => {});
    expect(opened).toHaveBeenCalledTimes(1);
    await screen.unmount();
    const once = jest.fn();
    await render(<RewardReveal grant={grant({ surprise: true })} onOpened={once} render={(_, o, open) => <Text onPress={open}>{o ? 'open' : 'closed'}</Text>} />);
    await fireEvent.press(screen.getByText('closed'));
    await fireEvent.press(screen.getByText('open'));
    expect(once).toHaveBeenCalledTimes(1);
  });

  test('RewardRevealModal: Close, then Nice! once opened', async () => {
    const close = jest.fn();
    await render(<RewardRevealModal grant={grant({ surprise: true })} onClose={close} />);
    expect(screen.getByRole('button', { name: x.reveal.close })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('reward-reveal-open'));
    await fireEvent.press(await screen.findByRole('button', { name: x.reveal.nice }));
    expect(close).toHaveBeenCalled();
  });

  test('RewardToastListener: a toast for a plain grant, the reveal for a surprise, held until celebrateNow, onGrant overrides', async () => {
    const s = setup();
    await act(() => s.controller.refresh());
    await render(s.wrap(<RewardToastListener controller={s.controller} />));
    s.server.verifySocial();
    s.server.social = 'pending';
    s.server.verifySocial();
    await act(() => s.controller.refresh());
    expect(await screen.findByTestId('reward-toast')).toHaveTextContent(x.gotReward('200 coins'));
    s.server.grantMystery();
    await act(() => s.controller.refresh());
    expect(await screen.findByText(x.reveal.title)).toBeOnTheScreen();
    await screen.unmount();

    const s2 = setup();
    await act(() => s2.controller.refresh());
    const got: string[] = [];
    await render(s2.wrap(<RewardToastListener controller={s2.controller} holdUntilMoment onGrant={(g) => got.push(g.program)} />));
    s2.server.grantMystery();
    await act(() => s2.controller.refresh());
    expect(got).toEqual([]);
    await act(() => s2.controller.celebrateNow());
    expect(got).toEqual(['daily']);
  });
});

describe('ad button and follow-up settings', () => {
  test('RewardedAdButton: verified refreshes now and later and reports; not verified shows a line; hidden when disabled', async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      await render(s.wrap(<RewardedAdButton controller={s.controller} label="Watch an ad" onShowAd={async () => true} refreshAfterMs={[5000]} />));
      await act(() => jest.advanceTimersByTime(10));
      const before = s.server.called('rewards_state').length;
      await fireEvent.press(screen.getByRole('button', { name: 'Watch an ad' }));
      await act(() => jest.advanceTimersByTime(5000));
      expect(s.server.called('rewards_state').length).toBeGreaterThanOrEqual(before + 2);
      expect(s.events.find((e) => e.name === RewardsEventName.adRewardShown)!.props).toEqual({ result: 'verified' });
      await screen.unmount();
      await render(s.wrap(<RewardedAdButton controller={s.controller} label="Watch" onShowAd={async () => false} />));
      await fireEvent.press(screen.getByRole('button', { name: 'Watch' }));
      expect(screen.getByText(x.programs.adNotVerified)).toBeOnTheScreen();
      await screen.unmount();
      await render(s.wrap(<RewardedAdButton controller={s.controller} label="Off" enabled={false} onShowAd={async () => true} />));
      expect(screen.queryByText('Off')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('FollowupSettings: loads, toggles send inverted keys, time saved as HH:MM, choices applied', async () => {
    const s = setup();
    await act(() => s.controller.refresh());
    const changed = jest.fn();
    await render(s.wrap(<FollowupSettings controller={s.controller} showChoices onChanged={changed} pickTime={async () => ({ hour: 8, minute: 30 })} />));
    await fireEvent(await screen.findByTestId('followup-reminders'), 'valueChange', false);
    const patches = s.server.called('rewards_followup_prefs').map((p) => p['patch']).filter((p) => p != null && Object.keys(p as object).length > 0);
    expect(patches[0]).toEqual({ notifications_off: true });
    await fireEvent(screen.getByTestId('followup-reminders'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('followup-time'));
    expect(await screen.findByText('08:30')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('choice-timers'), 'valueChange', false);
    await act(async () => {});
    expect(s.controller.state.choices.timersOff).toBe(true);
    expect(changed).toHaveBeenCalled();
  });

  test('FollowupSettings: a failed save is undone with a line; a failed load offers Retry', async () => {
    const s = setup();
    s.server.offline = true;
    await render(s.wrap(<FollowupSettings controller={s.controller} />));
    expect(await screen.findByRole('button', { name: x.followups.retry })).toBeOnTheScreen();
    s.server.offline = false;
    await fireEvent.press(screen.getByRole('button', { name: x.followups.retry }));
    const sw = await screen.findByTestId('followup-emails');
    const was = sw.props.value as boolean;
    s.server.offline = true;
    await fireEvent(sw, 'valueChange', !was);
    expect(await screen.findByText(x.error('offline'))).toBeOnTheScreen();
    expect(screen.getByTestId('followup-emails').props.value).toBe(was);
  });
});
