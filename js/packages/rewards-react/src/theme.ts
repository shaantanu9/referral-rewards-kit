'use client';
import {
  darkRewardsTheme,
  lightRewardsTheme,
  resolveRewardsTheme,
  rewardsThemeCssVars,
  type RewardsTheme,
  type RewardsThemeOverrides,
} from '@myind/rewards-core';
import type { CSSProperties } from 'react';

/**
 * The theme as a `style` object of `--rk-*` variables: put it on any element above the components (or on one
 * component's `style`) to recolour them. `base` picks the defaults that fill the gaps: `'light'` (default) or `'dark'`.
 *
 * ```tsx
 * <div style={rewardsThemeStyle({ accent: '#0B57D0', radius: 12 })}><RewardsHub /></div>
 * ```
 */
export function rewardsThemeStyle(overrides: RewardsThemeOverrides = {}, base: 'light' | 'dark' | RewardsTheme = 'light'): CSSProperties {
  const b = base === 'light' ? lightRewardsTheme : base === 'dark' ? darkRewardsTheme : base;
  return rewardsThemeCssVars(resolveRewardsTheme(overrides, b)) as CSSProperties;
}
