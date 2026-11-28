// Ports of widgets_test.dart (OfferBanner, SocialTagTask) and widgets_v2_test.dart (RewardedAdButton, link field).
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfferBanner, RewardedAdButton, SocialTagTask } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OfferBanner', () => {
  it('shows the reward, the real stock and time left; claim calls the server and hides it', async () => {
    const r = await loaded(rig());
    const claimed = vi.fn();
    const { container } = renderWith(r, <OfferBanner program="welcome" title="Welcome gift" onClaimed={claimed} />);
    expect(screen.getByText('100 coins')).toBeTruthy();
    expect(screen.getByText('7 left')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Ends in 30m 00s');
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await flush();
    expect(r.server.called('rewards_offer_claim')).toHaveLength(1);
    expect(claimed).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.rk-offer')).toBeNull();
    expect(r.controller.state.inbox[0]!.amount).toBe(100);
  });

  it('sold out on claim: the default look hides it', async () => {
    const r = await loaded(rig());
    r.server.sellOutOffer();
    const { container } = renderWith(r, <OfferBanner program="welcome" />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await flush();
    expect(container.querySelector('.rk-offer')).toBeNull();
    expect(r.controller.state.offer('welcome')!.status).toBe('sold_out');
  });

  it('the deadline passing hides it without a server call', async () => {
    vi.useFakeTimers();
    const r = await loaded(rig());
    const { container } = renderWith(r, <OfferBanner program="welcome" />);
    const calls = r.server.calls.length;
    r.advance(30 * 60 * 1000);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(container.querySelector('.rk-offer')).toBeNull();
    expect(r.server.calls.length).toBe(calls);
  });

  it('timers off: no countdown, the offer still shows; render gets every state', async () => {
    const r = rig();
    r.server.followups.prefs['timers_off'] = true;
    await r.controller.refresh();
    renderWith(r, <OfferBanner program="welcome" />);
    expect(screen.getByText('100 coins')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    r.server.expireOffer();
    await act(async () => {
      await r.controller.refresh();
    });
    renderWith(r, <OfferBanner program="welcome" render={(o) => <i>state {o.status}</i>} />);
    expect(screen.getByText('state expired')).toBeTruthy();
  });
});

describe('SocialTagTask', () => {
  it('none: enter the username and get a code', async () => {
    const r = await loaded(rig());
    renderWith(r, <SocialTagTask program="ig" />);
    expect(screen.getByRole('heading', { name: 'Tag @myapp on Instagram' })).toBeTruthy();
    expect(screen.getByText('200 coins')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Instagram username/), { target: { value: 'me.reads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get my code' }));
    await flush();
    expect(r.server.called('rewards_social_start')[0]).toMatchObject({ handle: 'me.reads' });
    expect(screen.getByText('DEMO-K7Q2HX')).toBeTruthy();
    expect(screen.getByText('Post a photo, reel or story, tag @myapp, and put this code in the caption.')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('We look for your post for 7d 0h');
  });

  it('a refusal shows its line', async () => {
    const r = await loaded(rig());
    r.server.social = 'verified';
    renderWith(r, <SocialTagTask program="ig" />);
    fireEvent.click(screen.getByRole('button', { name: 'Get my code' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('You already got this reward.');
  });

  it('pending: copy and open Instagram call the app; events carry no code', async () => {
    const r = await loaded(rig());
    await r.controller.startSocial('ig', 'me');
    const copied: string[] = [];
    const opened: string[] = [];
    renderWith(r, <SocialTagTask program="ig" onCopy={(c) => void copied.push(c)} onOpenInstagram={(a) => opened.push(a)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await flush();
    expect(copied).toEqual(['DEMO-K7Q2HX']);
    expect(screen.getByRole('button', { name: 'Code copied' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Instagram' }));
    expect(opened).toEqual(['myapp']);
    const names = r.events.map((e) => e.name);
    expect(names).toContain('rewards_social_code_copied');
    expect(names).toContain('rewards_instagram_opened');
    expect(JSON.stringify(r.events)).not.toContain('DEMO-K7Q2HX');
  });

  it('the default copy uses the browser clipboard; no Instagram button without a callback', async () => {
    const r = await loaded(rig());
    await r.controller.startSocial('ig', 'me');
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderWith(r, <SocialTagTask program="ig" />);
    expect(screen.queryByRole('button', { name: 'Open Instagram' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await flush();
    expect(writeText).toHaveBeenCalledWith('DEMO-K7Q2HX');
  });

  it('verified and rejected states', async () => {
    const r = await loaded(rig());
    await r.controller.startSocial('ig', 'me');
    r.server.verifySocial();
    await r.controller.refresh();
    const a = renderWith(r, <SocialTagTask program="ig" />);
    expect(screen.getByText('Thanks for the post! Reward added.')).toBeTruthy();
    a.unmount();
    r.server.rejectSocial();
    await r.controller.refresh();
    renderWith(r, <SocialTagTask program="ig" />);
    expect(screen.getByText('We could not match your post. You can try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get my code' })).toBeTruthy();
  });

  it('the link field sends the post link, then says so; a bad link has its line; render', async () => {
    const r = await loaded(rig());
    await r.controller.startSocial('ig', 'me');
    renderWith(r, <SocialTagTask program="ig" showLinkField />);
    const field = screen.getByLabelText('Link to your post');
    fireEvent.change(field, { target: { value: 'https://example.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('That does not look like a link to a post.');
    fireEvent.change(field, { target: { value: 'https://www.instagram.com/p/abc/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await flush();
    expect(screen.getByText('Link sent. We will check it.')).toBeTruthy();
    expect(JSON.stringify(r.events)).not.toContain('instagram.com/p');
    renderWith(r, <SocialTagTask program="ig" render={(t) => <i>task {t.status}</i>} />);
    expect(screen.getByText('task pending')).toBeTruthy();
  });
});

describe('RewardedAdButton', () => {
  it('verified: reloads now, after 5 s and after 20 s; reported; disabled while showing', async () => {
    vi.useFakeTimers();
    const r = await loaded(rig());
    let finish!: (ok: boolean) => void;
    const onShowAd = vi.fn(() => new Promise<boolean>((res) => (finish = res)));
    renderWith(r, <RewardedAdButton label="Watch an ad for 10 coins" onShowAd={onShowAd} />);
    const button = screen.getByRole('button', { name: /Watch an ad/ }) as HTMLButtonElement;
    fireEvent.click(button);
    await flush();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onShowAd).toHaveBeenCalledTimes(1);
    const before = r.server.called('rewards_state').length;
    await act(async () => finish(true));
    await flush();
    expect(r.server.called('rewards_state').length).toBe(before + 1);
    expect(button.disabled).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();
    expect(r.server.called('rewards_state').length).toBe(before + 2);
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await flush();
    expect(r.server.called('rewards_state').length).toBe(before + 3);
    expect(r.events.filter((e) => e.name === 'rewards_ad_reward_shown').map((e) => e.props['result'])).toEqual(['verified']);
  });

  it('not verified and an error show a line and do not reload; hidden when not enabled; render', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <RewardedAdButton label="Ad" onShowAd={async () => false} />);
    const before = r.server.called('rewards_state').length;
    fireEvent.click(screen.getByRole('button', { name: /Ad/ }));
    await flush();
    expect(screen.getByRole('status').textContent).toBe('The ad did not finish, so there is no reward this time.');
    expect(r.server.called('rewards_state').length).toBe(before);
    a.unmount();
    renderWith(
      r,
      <RewardedAdButton
        label="Ad"
        onShowAd={async () => {
          throw new Error('no fill');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ad/ }));
    await flush();
    expect(screen.getByRole('status').textContent).toBe('The ad could not be shown. Try again later.');
    expect(r.events.filter((e) => e.name === 'rewards_ad_reward_shown').map((e) => e.props['result'])).toEqual(['not_verified', 'error']);
    const b = renderWith(r, <RewardedAdButton label="Hidden ad" enabled={false} onShowAd={async () => true} />);
    expect(b.container.textContent).toBe('');
    renderWith(r, <RewardedAdButton label="x" onShowAd={async () => true} render={(show, busy) => <i>{show ? 'ready' : 'no'} {String(busy)}</i>} />);
    expect(screen.getByText('ready false')).toBeTruthy();
  });
});
