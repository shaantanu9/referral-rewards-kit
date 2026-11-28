import { ClaimStatus, MemoryKeyValueStore, ReferralPromptPolicy } from '@myind/referral-core';
import { FakeReferralServer } from '@myind/referral-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  InviteCodeText,
  ReferralProvider,
  ReferralStore,
  useClaim,
  useInviteCode,
  useReferral,
  useReferralPrompt,
  useReferralTerms,
  useReferralStore,
} from '../src';
import { clock, harness, renderKit } from './support';

function wrap(h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) {
  return ({ children }: { children: ReactNode }) => (
    <ReferralProvider client={h.client} queue={h.queue} clock={clock} retryPendingClaims={false} {...extra}>
      {children}
    </ReferralProvider>
  );
}

describe('hooks', () => {
  it('ReferralStore: same snapshot until a change; useReferralStore re-renders', () => {
    const s = new ReferralStore({ n: 1 });
    const a = s.getSnapshot();
    s.set({ n: 1 });
    expect(s.getSnapshot()).toBe(a);
    const { result } = renderHook(() => useReferralStore(s));
    act(() => s.set({ n: 2 }));
    expect(result.current.n).toBe(2);
  });

  it('useInviteCode: the code, cached; offline falls back to the cache', async () => {
    const h = harness();
    const cache = new MemoryKeyValueStore();
    const { result } = renderHook(() => useInviteCode(), { wrapper: wrap(h, { codeCache: cache }) });
    await waitFor(() => expect(result.current.value?.code).toBe(FakeReferralServer.myCode));
    expect(await cache.getString('my_code')).toBe(FakeReferralServer.myCode);
    h.server.offline = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.value?.code).toBe(FakeReferralServer.myCode);
  });

  it('useReferralTerms: loads, or reports unavailable', async () => {
    const h = harness();
    const { result } = renderHook(() => useReferralTerms(), { wrapper: wrap(h) });
    await waitFor(() => expect(result.current.value?.claimDaysLeft).toBe(3));
    const h2 = harness();
    h2.server.signedIn = false;
    const r2 = renderHook(() => useReferralTerms(), { wrapper: wrap(h2) });
    await waitFor(() => expect(r2.result.current.unavailable).toBe('signed_out'));
  });

  it('useClaim: claims through the queue and keeps an offline claim', async () => {
    const h = harness();
    const { result } = renderHook(() => useClaim(), { wrapper: wrap(h) });
    h.server.offline = true;
    await act(async () => {
      await result.current.claim(FakeReferralServer.friendCode);
    });
    expect(result.current.outcome?.status).toBe(ClaimStatus.queuedOffline);
    expect(await h.queue.pendingCode()).toBe(FakeReferralServer.friendCode);
  });

  it('useReferralPrompt: never in the first session', async () => {
    const policy = new ReferralPromptPolicy({ store: new MemoryKeyValueStore(), clock });
    await policy.startSession();
    policy.reportMomentOfValue();
    const { result } = renderHook(() => useReferralPrompt(policy));
    await act(async () => {
      expect(await result.current.check()).toBe(false);
    });
    expect(result.current.shouldPrompt).toBe(false);
  });

  it('the provider resolves the locale and overrides', () => {
    const h = harness();
    const { result } = renderHook(() => useReferral(), {
      wrapper: wrap(h, { locale: 'id', l10nOverrides: { share: 'Bagikan sekarang' } }),
    });
    expect(result.current.l10n.share).toBe('Bagikan sekarang');
    expect(result.current.locale).toBe('id');
  });

  it('the provider retries a kept claim when the browser comes back online', async () => {
    const h = harness();
    h.server.offline = true;
    await h.queue.claim(FakeReferralServer.friendCode);
    h.server.offline = false;
    renderKit(h, <InviteCodeText code="K7QM2XRA" />, { retryPendingClaims: true });
    await waitFor(() => expect(h.server.claimed).toBe(true));
    expect(await h.queue.pendingCode()).toBeNull();
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('img', { name: 'K 7 Q M, 2 X R A' })).toBeTruthy();
  });
});
