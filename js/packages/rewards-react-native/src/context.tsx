import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, useColorScheme } from 'react-native';
import {
  darkRewardsTheme,
  lightRewardsTheme,
  resolveRewardsTheme,
  rewardsTexts,
  type QuizController,
  type QuizSnapshot,
  type RewardsController,
  type RewardsSnapshot,
  type RewardsTexts,
  type RewardsTextsOverrides,
  type RewardsTheme,
  type RewardsThemeOverrides,
} from '@myind/rewards-core';

/** What every rewards component reads when its own prop is not given. All optional. */
export interface RewardsKitConfig {
  /** Ready texts (`rewardsTexts({...})`); wins over [textOverrides]. */
  readonly texts?: RewardsTexts;
  /** The app's words over the English defaults. */
  readonly textOverrides?: RewardsTextsOverrides;
  /** Light colours over Material 3's baseline (`lightRewardsTheme`). */
  readonly theme?: RewardsThemeOverrides;
  /** Dark colours over `darkRewardsTheme`. */
  readonly darkTheme?: RewardsThemeOverrides;
  /** Forces a scheme; default the device's (`useColorScheme`). */
  readonly colorScheme?: 'light' | 'dark';
  /** Copies a social code; default none (the code is selectable text). `expoClipboard` in `/clipboard`. */
  readonly copyText?: (text: string) => Promise<void>;
  /** Opens the attribution link; default `Linking.openURL`. */
  readonly openUrl?: (url: string) => unknown;
  /** A haptic tap when a surprise opens, e.g. expo-haptics `() => impactAsync(ImpactFeedbackStyle.Medium)`. */
  readonly onHaptic?: () => void;
}

const Ctx = createContext<RewardsKitConfig>({});

/** Sets the words, colours and platform adapters for every rewards component below it. */
export function RewardsKitProvider({ children, ...config }: RewardsKitConfig & { children?: ReactNode }): ReactNode {
  const parent = useContext(Ctx);
  // Nested providers add to the outer one; undefined values do not erase it.
  const value: RewardsKitConfig = { ...parent };
  for (const [k, v] of Object.entries(config)) if (v !== undefined) (value as Record<string, unknown>)[k] = v;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface RewardsKit {
  readonly texts: RewardsTexts;
  readonly theme: RewardsTheme;
  readonly dark: boolean;
  readonly copyText: ((text: string) => Promise<void>) | undefined;
  readonly openUrl: (url: string) => unknown;
  readonly onHaptic: (() => void) | undefined;
}

const openWithLinking = (url: string): Promise<void> => Linking.openURL(url).catch(() => {});

/** The resolved configuration (texts, theme for the current colour scheme, adapters). */
export function useRewardsKit(): RewardsKit {
  const c = useContext(Ctx);
  const device = useColorScheme();
  const dark = (c.colorScheme ?? device) === 'dark';
  const texts = useMemo(() => c.texts ?? rewardsTexts(c.textOverrides ?? {}), [c.texts, c.textOverrides]);
  const theme = useMemo(
    () => (dark ? resolveRewardsTheme(c.darkTheme, darkRewardsTheme) : resolveRewardsTheme(c.theme, lightRewardsTheme)),
    [dark, c.theme, c.darkTheme],
  );
  return { texts, theme, dark, copyText: c.copyText, openUrl: c.openUrl ?? openWithLinking, onHaptic: c.onHaptic };
}

/** The controller's current snapshot; re-renders on every change (`useSyncExternalStore`, no tearing). */
export function useRewards(controller: RewardsController): RewardsSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** The quiz's current snapshot, refreshed on every change and countdown tick. */
export function useQuiz(quiz: QuizController): QuizSnapshot {
  return useSyncExternalStore(quiz.subscribe, quiz.getSnapshot, quiz.getSnapshot);
}
