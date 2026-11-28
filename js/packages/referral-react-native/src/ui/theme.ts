/**
 * Colours of the default referral screens, as tokens. The Flutter widgets read the app's Material `ColorScheme`; here
 * the defaults are Material 3's baseline light and dark schemes (the same values as `@myind/rewards-core`'s theme for
 * the shared roles: `primary` = rewards `accent`, `onSurfaceVariant` = `muted`, `error` = `warning`), picked by
 * `useColorScheme()`. Pass overrides to `ReferralKitProvider` (or `resolveReferralTheme`) to use the app's colours.
 */
export interface ReferralTheme {
  readonly primary: string;
  readonly onPrimary: string;
  /** Page background. */
  readonly background: string;
  /** Cards (reward card, welcome card, QR sheet). */
  readonly card: string;
  readonly onSurface: string;
  /** Secondary text. */
  readonly onSurfaceVariant: string;
  /** Borders of outlined buttons and fields. */
  readonly outline: string;
  readonly secondaryContainer: string;
  readonly onSecondaryContainer: string;
  readonly tertiaryContainer: string;
  readonly onTertiaryContainer: string;
  readonly errorContainer: string;
  readonly onErrorContainer: string;
  readonly error: string;
  /** Corner radius of cards. */
  readonly radius: number;
}

export const lightReferralTheme: ReferralTheme = Object.freeze({
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  background: '#FEF7FF',
  card: '#F7F2FA',
  onSurface: '#1D1B20',
  onSurfaceVariant: '#49454F',
  outline: '#79747E',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  tertiaryContainer: '#FFD8E4',
  onTertiaryContainer: '#31111D',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  error: '#B3261E',
  radius: 12,
});

export const darkReferralTheme: ReferralTheme = Object.freeze({
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  background: '#141218',
  card: '#1D1B20',
  onSurface: '#E6E0E9',
  onSurfaceVariant: '#CAC4D0',
  outline: '#938F99',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',
  errorContainer: '#8C1D18',
  onErrorContainer: '#F9DEDC',
  error: '#F2B8B5',
  radius: 12,
});

export type ReferralThemeOverrides = Partial<ReferralTheme>;

/** [base] (light by default) with the app's [overrides]; undefined values are ignored. */
export function resolveReferralTheme(overrides: ReferralThemeOverrides = {}, base: ReferralTheme = lightReferralTheme): ReferralTheme {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return Object.freeze({ ...base, ...clean });
}
