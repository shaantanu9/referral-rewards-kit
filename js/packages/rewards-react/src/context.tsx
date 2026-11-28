'use client';
/**
 * The provider and hooks: one [RewardsController] (and the texts) for every component below it, read with
 * `useSyncExternalStore` so a render never tears. Every component also takes `controller` / `texts` props, which win
 * over the provider.
 */
import {
  defaultRewardsTexts,
  QuizController,
  type QuizSnapshot,
  type RewardsController,
  type RewardsSnapshot,
  type RewardsState,
  type RewardsTexts,
} from '@myind/rewards-core';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

interface RewardsContextValue {
  readonly controller: RewardsController | null;
  readonly texts: RewardsTexts;
}

const RewardsContext = createContext<RewardsContextValue>({ controller: null, texts: defaultRewardsTexts });

export interface RewardsProviderProps {
  /** The app's controller (make it once, e.g. `useState(() => new RewardsController({ client }))`). Not disposed here. */
  readonly controller: RewardsController;
  /** Every string the components show: `rewardsTexts({ claim: 'Grab it' })`. Default English. */
  readonly texts?: RewardsTexts;
  readonly children?: ReactNode;
}

/** Gives every rewards component below it the same controller and texts. Renders no element of its own. */
export function RewardsProvider({ controller, texts, children }: RewardsProviderProps): ReactNode {
  const parent = useContext(RewardsContext);
  return (
    <RewardsContext.Provider value={{ controller, texts: texts ?? parent.texts }}>{children}</RewardsContext.Provider>
  );
}

/** The controller from [own] or the nearest `RewardsProvider`; throws a clear error when there is neither. */
export function useRewardsController(own?: RewardsController | null): RewardsController {
  const ctx = useContext(RewardsContext);
  const c = own ?? ctx.controller;
  if (!c) throw new Error('@myind/rewards-react: pass `controller` or wrap the component in <RewardsProvider controller={…}>.');
  return c;
}

/** The texts from [own], the nearest `RewardsProvider`, or the English defaults. */
export function useRewardsTexts(own?: RewardsTexts | null): RewardsTexts {
  const ctx = useContext(RewardsContext);
  return own ?? ctx.texts;
}

/** The controller's current snapshot (re-renders on every change). */
export function useRewards(controller?: RewardsController | null): RewardsSnapshot {
  const c = useRewardsController(controller);
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}

/** The controller's current `RewardsState` (re-renders on every change). */
export function useRewardsState(controller?: RewardsController | null): RewardsState {
  return useRewards(controller).state;
}

/**
 * Loads the state once on mount when nobody has yet (port of `RewardsListener`'s first-frame refresh). Returns the
 * snapshot; `snapshot.visible` says whether anything should be shown.
 */
export function useRewardsListener(controller?: RewardsController | null): RewardsSnapshot {
  const c = useRewardsController(controller);
  const snap = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  useEffect(() => {
    if (!c.loaded && !c.loading) void c.refresh();
  }, [c]);
  return snap;
}

const noSubscribe = (): (() => void) => () => {};
const nullSnapshot = (): null => null;

/** A quiz controller's current snapshot, or null for null. */
export function useQuizSnapshot(quiz: QuizController | null): QuizSnapshot | null {
  return useSyncExternalStore(quiz ? quiz.subscribe : noSubscribe, quiz ? quiz.getSnapshot : nullSnapshot, quiz ? quiz.getSnapshot : nullSnapshot);
}

export interface UseQuizOptions {
  readonly controller?: RewardsController | null;
  /** Your own quiz controller: used as is, never disposed here. */
  readonly quiz?: QuizController | null;
  /** Open today's quiz once it is made (default true). */
  readonly open?: boolean;
  /** Passed to a made controller: how long right / wrong stays (default 2000 ms; null waits for `next`). */
  readonly revealForMs?: number | null;
}

/**
 * A `QuizController` for [program], made after mount (so it is safe in SSR and React StrictMode) and disposed on
 * unmount, with its snapshot. Grants go to the rewards controller; the countdown uses its synced clock.
 */
export function useQuiz(program: string, opts: UseQuizOptions = {}): { quiz: QuizController | null; snapshot: QuizSnapshot | null } {
  const rewards = useRewardsController(opts.controller);
  const own = opts.quiz ?? null;
  const [made, setMade] = useState<QuizController | null>(null);
  const open = opts.open ?? true;
  const revealForMs = opts.revealForMs;
  useEffect(() => {
    if (own) {
      if (open && own.phase === 'idle') void own.open();
      return undefined;
    }
    const q = new QuizController({
      client: rewards.client,
      program,
      rewards,
      ...(revealForMs === undefined ? {} : { revealForMs }),
    });
    setMade(q);
    if (open) void q.open();
    return () => {
      q.dispose();
      setMade((m) => (m === q ? null : m));
    };
  }, [own, rewards, program, open, revealForMs]);
  const quiz = own ?? made;
  return { quiz, snapshot: useQuizSnapshot(quiz) };
}
