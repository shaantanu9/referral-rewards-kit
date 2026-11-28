/**
 * Colours, shape and text styles of the default widgets, as design tokens (port of the Flutter `RewardsTheme`
 * ThemeExtension). The Flutter widgets fill missing values from the app's Material `ColorScheme`; here the defaults
 * are Material 3's baseline light and dark schemes, so the web and React Native widgets look the same out of the box.
 * Pass a partial theme to [resolveRewardsTheme]; for a different layout, use each widget's render prop.
 */

/** A text style token: what both CSS and React Native understand. */
export interface RewardsTextStyle {
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly lineHeight: number;
}

export interface RewardsTheme {
  /** Buttons, progress, highlights (Material `primary`). */
  readonly accent: string;
  readonly onAccent: string;
  /** The card every default widget sits in (`surfaceContainerHighest`). */
  readonly surface: string;
  readonly onSurface: string;
  /** Secondary text (`onSurfaceVariant`). */
  readonly muted: string;
  readonly success: string;
  /** "Ends soon" / "at risk" colour (`error`). */
  readonly warning: string;
  /** Card corner radius in px / dp. */
  readonly radius: number;
  /** Card padding in px / dp. */
  readonly padding: number;
  readonly titleStyle: RewardsTextStyle;
  readonly bodyStyle: RewardsTextStyle;
  /** Big numbers (streak days, countdowns). */
  readonly numberStyle: RewardsTextStyle;
}

const styles = {
  titleStyle: { fontSize: 16, fontWeight: 500, lineHeight: 24 },
  bodyStyle: { fontSize: 14, fontWeight: 400, lineHeight: 20 },
  numberStyle: { fontSize: 28, fontWeight: 700, lineHeight: 36 },
} as const;

/** Material 3 baseline, light. */
export const lightRewardsTheme: RewardsTheme = Object.freeze({
  accent: '#6750A4',
  onAccent: '#FFFFFF',
  surface: '#E6E0E9',
  onSurface: '#1D1B20',
  muted: '#49454F',
  success: '#388E3C',
  warning: '#B3261E',
  radius: 16,
  padding: 16,
  ...styles,
});

/** Material 3 baseline, dark. */
export const darkRewardsTheme: RewardsTheme = Object.freeze({
  accent: '#D0BCFF',
  onAccent: '#381E72',
  surface: '#36343B',
  onSurface: '#E6E0E9',
  muted: '#CAC4D0',
  success: '#81C784',
  warning: '#F2B8B5',
  radius: 16,
  padding: 16,
  ...styles,
});

/** Overrides for [resolveRewardsTheme]. */
export type RewardsThemeOverrides = Partial<Omit<RewardsTheme, 'titleStyle' | 'bodyStyle' | 'numberStyle'>> & {
  readonly titleStyle?: Partial<RewardsTextStyle>;
  readonly bodyStyle?: Partial<RewardsTextStyle>;
  readonly numberStyle?: Partial<RewardsTextStyle>;
};

/** The app's theme with every missing value filled from [base] (light by default). */
export function resolveRewardsTheme(overrides: RewardsThemeOverrides = {}, base: RewardsTheme = lightRewardsTheme): RewardsTheme {
  const { titleStyle, bodyStyle, numberStyle, ...rest } = overrides;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return Object.freeze({
    ...base,
    ...clean,
    titleStyle: { ...base.titleStyle, ...titleStyle },
    bodyStyle: { ...base.bodyStyle, ...bodyStyle },
    numberStyle: { ...base.numberStyle, ...numberStyle },
  });
}

/**
 * The theme as CSS custom properties (`--rk-accent`, `--rk-radius`, `--rk-title-size`, …) for the web widgets: spread
 * it into a `style` attribute or a `:root` rule.
 */
export function rewardsThemeCssVars(theme: RewardsTheme, prefix = '--rk-'): Record<string, string> {
  const vars: Record<string, string> = {
    [`${prefix}accent`]: theme.accent,
    [`${prefix}on-accent`]: theme.onAccent,
    [`${prefix}surface`]: theme.surface,
    [`${prefix}on-surface`]: theme.onSurface,
    [`${prefix}muted`]: theme.muted,
    [`${prefix}success`]: theme.success,
    [`${prefix}warning`]: theme.warning,
    [`${prefix}radius`]: `${theme.radius}px`,
    [`${prefix}padding`]: `${theme.padding}px`,
  };
  for (const [name, s] of [
    ['title', theme.titleStyle],
    ['body', theme.bodyStyle],
    ['number', theme.numberStyle],
  ] as const) {
    vars[`${prefix}${name}-size`] = `${s.fontSize}px`;
    vars[`${prefix}${name}-weight`] = String(s.fontWeight);
    vars[`${prefix}${name}-line-height`] = `${s.lineHeight}px`;
  }
  return vars;
}
