// Port of quiz_widgets_test.dart: QuizCard and QuizScreen (default flow, true / false, timeout, builder, offline),
// plus listen and picture questions through QuizBody.
import { QuizController, QuizQuestion, type QuizSnapshot } from '@myind/rewards-core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuizBody, QuizCard, QuizScreen } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

const choice = (i: number): HTMLButtonElement => screen.getByTestId(`quiz-choice-${i}`) as HTMLButtonElement;

describe('QuizCard', () => {
  it('not started: rules, time left today, Start opens the app route', async () => {
    const r = await loaded(rig());
    const opened: string[] = [];
    renderWith(r, <QuizCard program="quiz" onOpen={(p) => opened.push(p)} />);
    expect(screen.getByRole('heading', { name: 'Daily quiz' })).toBeTruthy();
    expect(screen.getByText('4 questions. Answer each one before its timer runs out.')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('New quiz in 1h 30m');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(opened).toEqual(['quiz']);
  });

  it('in progress: Resume; finished: the score; no attempts: come back, no button', async () => {
    const r = await loaded(rig());
    const q = new QuizController({ client: r.client, program: 'quiz', rewards: r.controller, revealForMs: null });
    await q.start();
    const a = renderWith(r, <QuizCard program="quiz" onOpen={() => {}} />);
    expect(screen.getByText('Question 1 of 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      await q.answer(1);
      await q.next();
    }
    q.dispose();
    await flush();
    expect(screen.getByText('2 of 4 right')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See result' })).toBeTruthy();
    a.unmount();
    r.server.newDay();
    r.server.quiz.attemptsLeft = 0;
    await r.controller.refresh();
    renderWith(r, <QuizCard program="quiz" />);
    expect(screen.getByText('Come back tomorrow for a new quiz')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('render replaces the look; without onOpen the quiz opens in a dialog', async () => {
    const r = await loaded(rig());
    renderWith(
      r,
      <>
        <QuizCard program="quiz" render={(q, open) => <button onClick={open}>{`mine ${q.status}`}</button>} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'mine not_started' }));
    await flush();
    const dialog = screen.getByRole('dialog', { name: 'Daily quiz' });
    expect(within(dialog).getByRole('button', { name: 'Start' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('QuizScreen', () => {
  it('default flow: rules → question → reveal → … → result with rewards', async () => {
    const r = await loaded(rig());
    const done = vi.fn();
    renderWith(r, <QuizScreen program="quiz" onDone={done} />);
    await flush();
    expect(screen.getByRole('region', { name: 'Daily quiz' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    expect(screen.getByText('Question 1 of 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Which planet is called the red planet?' })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    fireEvent.click(choice(1));
    await flush();
    expect(screen.getByText('Right!', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Iron oxide dust makes Mars look red.')).toBeTruthy();
    expect(choice(1).className).toContain('rk-choice--right');
    expect(within(choice(1)).getByRole('img', { name: 'Right!' })).toBeTruthy();
    expect(choice(0).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flush();
    expect(screen.getByText('Question 2 of 4')).toBeTruthy();
    fireEvent.click(choice(0));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flush();
    expect(screen.getByText('Which one does not belong?')).toBeTruthy();
    fireEvent.click(choice(2));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flush();
    // True / false with no choices: True and False.
    expect(choice(0).textContent).toBe('True');
    expect(choice(1).textContent).toBe('False');
    fireEvent.click(choice(0));
    await flush();
    expect(screen.getByText('Not quite', { selector: 'p' })).toBeTruthy();
    expect(choice(0).className).toContain('rk-choice--wrong');
    expect(choice(1).className).toContain('rk-choice--right');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flush(10);
    expect(screen.getByText('3 of 4 right')).toBeTruthy();
    expect(screen.getByText('You got 30 coins')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(r.controller.state.inbox.some((g) => g.amount === 30)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('a timeout shows that the time is up', async () => {
    vi.useFakeTimers();
    const r = await loaded(rig());
    const quiz = new QuizController({ client: r.client, program: 'quiz', rewards: r.controller, revealForMs: null });
    await quiz.open();
    await quiz.start();
    renderWith(r, <QuizScreen program="quiz" quiz={quiz} />);
    r.advance(15_000);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flush();
    expect(screen.getByText("Time's up")).toBeTruthy();
    expect(choice(1).className).toContain('rk-choice--right');
    quiz.dispose();
  });

  it('render replaces the body (no attribution); offline shows retry', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <QuizScreen program="quiz" render={(_, s) => <i>phase {s.phase}</i>} />);
    await flush();
    expect(screen.getByText('phase intro')).toBeTruthy();
    expect(a.container.querySelector('[data-testid="myind-attribution"]')).toBeNull();
    a.unmount();
    r.server.offline = true;
    renderWith(r, <QuizScreen program="quiz" title="Brain teaser" />);
    await flush();
    expect(screen.getByRole('heading', { name: 'Brain teaser' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('You are offline. Try again in a moment.');
    r.server.offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});

describe('QuizBody media', () => {
  const snapshotFor = (q: QuizQuestion): QuizSnapshot => ({
    phase: 'question',
    quiz: null,
    question: q,
    lastAnswer: null,
    picked: null,
    reason: null,
    unavailable: null,
    canStart: false,
    timeLeftMs: 10_000,
    timeFraction: 0.2,
    finishedGrants: [],
    version: 1,
  });
  const stub = { answer: vi.fn(async () => null), next: vi.fn(), retry: vi.fn(), start: vi.fn() } as unknown as QuizController;

  it('listen plays the sound through the app; picture draws through the app; a low timer turns the bar to warning', () => {
    const played: string[] = [];
    const listen = new QuizQuestion({ index: 0, total: 2, id: 'a', kind: 'listen', prompt: 'Which bird?', choices: ['Crow', 'Owl'], media: { sound_id: 'owl.mp3' } });
    const { container } = render(<QuizBody quiz={stub} snapshot={snapshotFor(listen)} onPlaySound={(s) => played.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play sound' }));
    expect(played).toEqual(['owl.mp3']);
    expect(container.querySelector('.rk-bar--warning')).toBeTruthy();
    fireEvent.click(choice(1));
    expect(stub.answer).toHaveBeenCalledWith(1);
    const picture = new QuizQuestion({ index: 1, total: 2, id: 'b', kind: 'picture', prompt: 'What is this?', choices: ['A', 'B'], media: { image_url: 'https://x/y.png' } });
    render(<QuizBody quiz={stub} snapshot={snapshotFor(picture)} renderImage={(url) => <img src={url} alt="the picture" />} />);
    expect((screen.getByRole('img', { name: 'the picture' }) as HTMLImageElement).src).toBe('https://x/y.png');
    render(<QuizBody quiz={stub} snapshot={snapshotFor(listen)} />);
    expect(screen.getAllByRole('button', { name: 'Play sound' })).toHaveLength(1);
  });
});
