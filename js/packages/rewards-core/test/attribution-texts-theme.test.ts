// Attribution (same links as referral-core, same source file), the 0.2–0.7 texts, and the theme tokens.
import { describe, expect, it } from 'vitest';
import {
  attributionLink,
  defaultRewardsTexts,
  formatPercent,
  humanize,
  lightRewardsTheme,
  darkRewardsTheme,
  MYIND_ATTRIBUTION,
  QuestTask,
  resolveRewardsTheme,
  rewardsThemeCssVars,
} from '../src';
import fixture from '../../../test-fixtures/attribution-links.json';
import referralSource from '../../referral-core/src/attribution.ts?raw';
import rewardsSource from '../src/attribution.ts?raw';

describe('attribution', () => {
  it('the same links as @myind/referral-core (js/test-fixtures/attribution-links.json)', () => {
    expect([0, 1, 2, 3].map((v) => attributionLink(v, fixture.source))).toEqual(fixture.links);
    expect(attributionLink(5, 'acme')).toEqual(fixture.links[1]);
    expect(MYIND_ATTRIBUTION.homeUrl).toBe('https://www.myind.ai/referral-kit');
  });
  it('the attribution file is identical in both cores (copy it when one changes)', () => {
    expect(rewardsSource).toBe(referralSource);
  });
});

describe('texts', () => {
  const t = defaultRewardsTexts;
  it('quiz', () => {
    expect(t.quiz.rules(1)).toBe('1 question. Answer each one before its timer runs out.');
    expect(t.quiz.rules(10)).toBe('10 questions. Answer each one before its timer runs out.');
    expect(t.quiz.questionOf(2, 10)).toBe('Question 2 of 10');
    expect(t.quiz.score(7, 10)).toBe('7 of 10 right');
  });
  it('programs', () => {
    expect(t.programs.questTask(new QuestTask({ key: 'read_3' }))).toBe('Read 3');
    expect(t.programs.friendWaiting('')).toBe('Waiting for your friend');
    expect(t.programs.friendWaiting('Asha')).toBe('Waiting for Asha');
    expect(t.programs.friendDays(1)).toBe('1 day together');
    expect(t.programs.recapBestStreak(6)).toBe('Best streak: 6 days');
    expect(t.programs.recapEvent('chapter_read', 9)).toBe('Chapter read: 9');
    expect(t.programs.goal(1, 2)).toBe('1/2');
  });
  it('fair play, recap card, follow-ups', () => {
    expect(t.fairPlay.repair(1, 20)).toBe('Do 1 more today to bring back your 20-day streak');
    expect(t.fairPlay.headStart(2, null)).toBe('Includes a head start of 2 from us');
    expect(t.fairPlay.headStart(2, ' A gift ')).toBe('A gift');
    expect(t.fairPlay.level(3, 'Explorer')).toBe('Level 3 · Explorer');
    expect(t.fairPlay.level(3, null)).toBe('Level 3');
    expect(t.fairPlay.toNextLevel(4, 8)).toBe('4 of 8 to the next level');
    expect(t.recapCard.yearTitle(2026)).toBe('Your 2026');
    expect(t.recapCard.daysActive(1)).toBe('day active');
    expect(t.followups.title).toBe('Reminders and emails');
  });
  it('0.1 lines', () => {
    expect(t.streakDays(3)).toBe('3-day streak');
    expect(t.nextIn('50 coins', 1)).toBe('50 coins in 1 more day');
    expect(t.progress(1, 3)).toBe('1 of 3');
    expect(t.socialTitle('myapp')).toBe('Tag @myapp on Instagram');
    expect(t.gotReward('5 coins')).toBe('You got 5 coins');
  });
  it('helpers', () => {
    expect(humanize('chapter_read')).toBe('Chapter read');
    expect(humanize('')).toBe('');
    expect([0, 0.0005, 0.5, 0.015, 0.123].map(formatPercent)).toEqual(['0%', '<0.1%', '50%', '1.5%', '12%']);
  });
});

describe('theme tokens', () => {
  it('defaults, overrides and CSS variables', () => {
    expect(lightRewardsTheme.radius).toBe(16);
    expect(darkRewardsTheme.accent).not.toBe(lightRewardsTheme.accent);
    const t = resolveRewardsTheme({ accent: '#FF5722', radius: 8, numberStyle: { fontSize: 40 } });
    expect([t.accent, t.radius, t.numberStyle.fontSize, t.numberStyle.fontWeight, t.surface]).toEqual(['#FF5722', 8, 40, 700, lightRewardsTheme.surface]);
    expect(resolveRewardsTheme({}, darkRewardsTheme).surface).toBe(darkRewardsTheme.surface);
    const vars = rewardsThemeCssVars(t);
    expect(vars['--rk-accent']).toBe('#FF5722');
    expect(vars['--rk-radius']).toBe('8px');
    expect(vars['--rk-number-size']).toBe('40px');
  });
});
