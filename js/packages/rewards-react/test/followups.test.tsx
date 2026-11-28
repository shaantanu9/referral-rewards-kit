// Port of followup_settings_test.dart, plus the 0.7 choices section (fair_play_settings_test.dart's intent).
import { rewardsTexts } from '@myind/rewards-core';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FollowupSettings, StreakCard } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

const sw = (name: string): HTMLButtonElement => screen.getByRole('switch', { name }) as HTMLButtonElement;
const on = (name: string): boolean => sw(name).getAttribute('aria-checked') === 'true';

describe('FollowupSettings', () => {
  it('loads after mount and shows the switches, one per kind, and the time', async () => {
    const r = await loaded(rig());
    renderWith(r, <FollowupSettings />);
    await flush();
    expect(r.server.called('rewards_followup_prefs')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Reminders and emails' })).toBeTruthy();
    expect(on('Reminders')).toBe(true);
    expect(sw('Reminders').getAttribute('aria-describedby')).toBeTruthy();
    expect(on('Comeback reminders')).toBe(true);
    expect(on('Sunday recap')).toBe(true);
    expect(on('Emails about my progress')).toBe(false);
    expect(screen.getByText('Default')).toBeTruthy();
    expect((screen.getByLabelText(/Reminder time/) as HTMLInputElement).value).toBe('19:00');
  });

  it('toggles send the inverted keys and report the change; kinds follow the main switch', async () => {
    const r = await loaded(rig());
    const changed = vi.fn();
    renderWith(r, <FollowupSettings onChanged={changed} />);
    await flush();
    fireEvent.click(sw('Comeback reminders'));
    await flush();
    expect(r.server.called('rewards_followup_prefs').at(-1)).toEqual({ patch: { muted_groups: ['comeback'] } });
    expect(on('Comeback reminders')).toBe(false);
    fireEvent.click(sw('Reminders'));
    await flush();
    expect(r.server.called('rewards_followup_prefs').at(-1)).toEqual({ patch: { notifications_off: true } });
    expect(sw('Sunday recap').disabled).toBe(true);
    expect((screen.getByLabelText(/Reminder time/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(sw('Emails about my progress'));
    await flush();
    expect(r.server.called('rewards_followup_prefs').at(-1)).toEqual({ patch: { emails_off: false } });
    expect(changed).toHaveBeenCalledTimes(3);
    expect(r.events.filter((e) => e.name === 'rewards_followup_prefs_changed').map((e) => e.props['field'])).toEqual(['muted_groups', 'notifications_off', 'emails_off']);
  });

  it('the time is saved as "HH:MM"', async () => {
    const r = await loaded(rig());
    renderWith(r, <FollowupSettings />);
    await flush();
    fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: '07:30' } });
    await flush();
    expect(r.server.called('rewards_followup_prefs').at(-1)).toEqual({ patch: { reminder_time: '07:30' } });
    expect(screen.queryByText('Default')).toBeNull();
    expect((screen.getByLabelText(/Reminder time/) as HTMLInputElement).value).toBe('07:30');
  });

  it('a failed save is undone and shows a short line', async () => {
    const r = await loaded(rig());
    renderWith(r, <FollowupSettings />);
    await flush();
    r.server.offline = true;
    fireEvent.click(sw('Reminders'));
    await flush();
    expect(on('Reminders')).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('You are offline. Try again in a moment.');
  });

  it('a failed load shows the line and a retry; texts and the emails switch are overridable', async () => {
    const r = await loaded(rig());
    r.server.offline = true;
    renderWith(r, <FollowupSettings showEmails={false} texts={rewardsTexts({ followups: { title: 'Nudges', retry: 'Again' } })} />);
    await flush();
    expect(screen.getByRole('heading', { name: 'Nudges' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    r.server.offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Reminders' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Emails about my progress' })).toBeNull();
  });

  it('render gets the prefs and a save function', async () => {
    const r = await loaded(rig());
    let save!: (p: Record<string, unknown>) => Promise<string | null>;
    renderWith(
      r,
      <FollowupSettings
        render={(prefs, s) => {
          save = s;
          return <i>{prefs == null ? 'loading' : `emails off ${String(prefs.emailsOff)}`}</i>;
        }}
      />,
    );
    await flush();
    expect(screen.getByText('emails off true')).toBeTruthy();
    expect(await save({ emails_off: false })).toBeNull();
    await flush();
    expect(screen.getByText('emails off false')).toBeTruthy();
  });

  it('showChoices: switching streaks off applies to the controller, so the streak card goes away', async () => {
    const r = await loaded(rig());
    renderWith(
      r,
      <>
        <StreakCard />
        <FollowupSettings showChoices />
      </>,
    );
    await flush();
    expect(screen.getByText('2-day streak')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How rewards look' })).toBeTruthy();
    expect(on('Surprise rewards')).toBe(true);
    fireEvent.click(sw('Show streaks'));
    await flush(10);
    expect(r.server.called('rewards_followup_prefs').at(-1)).toEqual({ patch: { streaks_off: true } });
    expect(r.controller.state.choices.streaksOff).toBe(true);
    expect(screen.queryByText('2-day streak')).toBeNull();
  });
});
