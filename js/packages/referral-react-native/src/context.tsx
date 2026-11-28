import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import {
  referralLocalizations,
  type ReferralKitLocalizations,
  type ReferralLauncher,
  type ReferralLocalizationOverrides,
  type ReferralTexts,
  type RewardLabels,
  type ShareHandler,
} from '@myind/referral-core';
import { linkingLauncher, rnShare, type QrRenderer, type ReferralClipboard } from './platform';
import { darkReferralTheme, lightReferralTheme, resolveReferralTheme, type ReferralTheme, type ReferralThemeOverrides } from './ui/theme';

/** What every referral component reads when its own prop is not given. All optional. */
export interface ReferralKitConfig {
  /** `en` (default), `hi`, `id`, or any language with [l10nOverrides] for every key. */
  readonly locale?: string;
  /** The app's own words per key (Flutter: the app's `ReferralKitLocalizations`). */
  readonly l10nOverrides?: ReferralLocalizationOverrides;
  /** Ready strings; wins over [locale] / [l10nOverrides]. */
  readonly l10n?: ReferralKitLocalizations;
  /** The app's voice for the invite screens. */
  readonly texts?: ReferralTexts;
  /** Names for reward kinds and entitlements. */
  readonly labels?: RewardLabels;
  /** Light colours over Material 3's baseline. */
  readonly theme?: ReferralThemeOverrides;
  /** Dark colours over Material 3's dark baseline. */
  readonly darkTheme?: ReferralThemeOverrides;
  /** Forces a scheme; default the device's (`useColorScheme`). */
  readonly colorScheme?: 'light' | 'dark';
  /** The share sheet; default React Native's `Share` ([rnShare]). */
  readonly share?: ShareHandler;
  /** Opens links; default `Linking` ([linkingLauncher]). */
  readonly launcher?: ReferralLauncher;
  /** Copy / Paste; none by default (the buttons are hidden). */
  readonly clipboard?: ReferralClipboard;
  /** Draws the invite QR code; none by default ("Show QR code" is hidden). */
  readonly renderQr?: QrRenderer;
}

const Ctx = createContext<ReferralKitConfig>({});

/** Sets the locale, words, colours and platform adapters for every referral component below it. */
export function ReferralKitProvider({ children, ...config }: ReferralKitConfig & { children?: ReactNode }): ReactNode {
  const parent = useContext(Ctx);
  // Nested providers add to the outer one; undefined values do not erase it.
  const value: ReferralKitConfig = { ...parent };
  for (const [k, v] of Object.entries(config)) if (v !== undefined) (value as Record<string, unknown>)[k] = v;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The resolved configuration: what a component uses when its own prop is not given. */
export interface ReferralKit {
  readonly l10n: ReferralKitLocalizations;
  readonly texts: ReferralTexts | undefined;
  readonly labels: RewardLabels;
  readonly theme: ReferralTheme;
  readonly dark: boolean;
  readonly share: ShareHandler;
  readonly launcher: ReferralLauncher;
  readonly clipboard: ReferralClipboard | undefined;
  readonly renderQr: QrRenderer | undefined;
}

export function useReferralKit(): ReferralKit {
  const c = useContext(Ctx);
  const device = useColorScheme();
  const dark = (c.colorScheme ?? device) === 'dark';
  const l10n = useMemo(() => c.l10n ?? referralLocalizations(c.locale ?? 'en', c.l10nOverrides ?? {}), [c.l10n, c.locale, c.l10nOverrides]);
  const theme = useMemo(
    () => (dark ? resolveReferralTheme(c.darkTheme, darkReferralTheme) : resolveReferralTheme(c.theme, lightReferralTheme)),
    [dark, c.theme, c.darkTheme],
  );
  return {
    l10n,
    texts: c.texts,
    labels: c.labels ?? {},
    theme,
    dark,
    share: c.share ?? rnShare,
    launcher: c.launcher ?? linkingLauncher,
    clipboard: c.clipboard,
    renderQr: c.renderQr,
  };
}
