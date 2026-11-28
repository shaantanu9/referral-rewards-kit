// The stylesheet's defaults are the core's theme tokens: every `--rk-*` variable of `rewardsThemeCssVars` is defined
// with the same value, light at :root and dark under prefers-color-scheme and data-theme="dark".
import { darkRewardsTheme, lightRewardsTheme, rewardsThemeCssVars } from '@myind/rewards-core';
import { expect, it } from 'vitest';
import css from '../src/styles.css?raw';
import { rewardsThemeStyle } from '../src';

const block = (selectorStart: string): string => {
  const at = css.indexOf(selectorStart);
  expect(at).toBeGreaterThanOrEqual(0);
  return css.substring(at, css.indexOf('}', at));
};
const value = (b: string, name: string): string | null => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(b);
  return m ? m[1]!.trim().toLowerCase() : null;
};

it('light defaults equal the core light theme', () => {
  const b = block(':root,');
  for (const [k, v] of Object.entries(rewardsThemeCssVars(lightRewardsTheme))) expect([k, value(b, k)]).toEqual([k, v.toLowerCase()]);
});

it('dark defaults equal the core dark theme, for the media query and data-theme', () => {
  const colours = ['--rk-accent', '--rk-on-accent', '--rk-surface', '--rk-on-surface', '--rk-muted', '--rk-success', '--rk-warning'];
  const dark = rewardsThemeCssVars(darkRewardsTheme);
  for (const b of [block(":root:not([data-theme='light'])"), block(":where([data-theme='dark'])")]) {
    for (const k of colours) expect([k, value(b, k)]).toEqual([k, dark[k]!.toLowerCase()]);
  }
});

it('rewardsThemeStyle gives the variables for a style attribute', () => {
  const s = rewardsThemeStyle({ accent: '#0B57D0', radius: 12 }) as Record<string, string>;
  expect(s['--rk-accent']).toBe('#0B57D0');
  expect(s['--rk-radius']).toBe('12px');
  expect(s['--rk-on-surface']).toBe(lightRewardsTheme.onSurface);
  expect((rewardsThemeStyle({}, 'dark') as Record<string, string>)['--rk-accent']).toBe(darkRewardsTheme.accent);
});

it('every interactive control has a visible focus ring and a 44 px target', () => {
  expect(css).toMatch(/\.rk-button:focus-visible/);
  expect(css).toMatch(/\.rk-attribution__link:focus-visible/);
  expect(value(block('.rk-button {'), 'min-height')).toBe('44px');
  expect(value(block('.rk-attribution__link {'), 'min-height')).toBe('44px');
  expect(value(block('.rk-attribution__link {'), 'min-width')).toBe('44px');
});
