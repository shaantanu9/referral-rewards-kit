import {
  ClaimStatus,
  extractInviteCode,
  formatCode,
  isWellFormedCode,
  normaliseCode,
  pastedCodeText,
  ReferralEvent,
  ReferralEventName,
  ReferralUnavailableException,
  type ClaimResult,
  type PendingClaimQueue,
  type ReferralClient,
  type ReferralTerms,
  type ReferralUnavailableReason,
} from '@myind/referral-core';
import { ReferralStore } from '../store';

/** The message under the field, as a kind so it follows the current language. */
export type CodeEntryMessage =
  | { readonly kind: 'claimOk' }
  | { readonly kind: 'offlineQueued' }
  | { readonly kind: 'notVerified' }
  | { readonly kind: 'notAvailableCodeKept' }
  | { readonly kind: 'claim'; readonly result: ClaimResult };

export interface CodeEntryState {
  /** The terms (given or loaded); null until loaded, or when they could not be loaded (offline). */
  readonly terms: ReferralTerms | null;
  /** A code from a link or the install referrer, offered for one tap. */
  readonly prefilled: string | null;
  /** The field's text. */
  readonly text: string;
  readonly message: CodeEntryMessage | null;
  readonly busy: boolean;
  /** A code was accepted. */
  readonly done: boolean;
  /** A code is kept in the queue (offline or not verified). */
  readonly codeKept: boolean;
  readonly unavailable: ReferralUnavailableReason | null;
}

export interface CodeEntryOptions {
  client: ReferralClient;
  queue: PendingClaimQueue;
  terms?: ReferralTerms | null;
  initialCode?: string | null;
  /** Analytics for this widget's own events; the client's sink when null. */
  emit: (e: ReferralEvent) => void;
  onClaimed?: ((result: ClaimResult) => void) | null;
}

/**
 * The code entry's logic (Flutter `_InviteCodeEntryState`): loads the terms when not given, offers a link code for
 * one tap, shows a code kept in the queue, claims through the queue (offline and `not_verified` claims are kept),
 * reports `code_entry_started` once and a closed window once.
 */
export class CodeEntryController {
  readonly store: ReferralStore<CodeEntryState>;
  opts: CodeEntryOptions;
  private started = false;
  private entryStarted = false;
  private closedReported = false;

  constructor(opts: CodeEntryOptions) {
    this.opts = opts;
    const pre = normaliseCode(opts.initialCode);
    this.store = new ReferralStore<CodeEntryState>({
      terms: opts.terms ?? null,
      prefilled: isWellFormedCode(pre) ? pre : null,
      text: '',
      message: null,
      busy: false,
      done: false,
      codeKept: false,
      unavailable: null,
    });
  }

  get state(): CodeEntryState {
    return this.store.getSnapshot();
  }

  start(daysLeft: (terms: ReferralTerms) => number | null): void {
    if (this.started) return;
    this.started = true;
    const pre = this.state.prefilled;
    if (pre) this.opts.client.reportLinkOpened(pre);
    if (this.state.terms == null) void this.loadTerms(daysLeft);
    else this.reportIfClosed(daysLeft(this.state.terms));
    void this.loadKept();
  }

  private async loadTerms(daysLeft: (terms: ReferralTerms) => number | null): Promise<void> {
    try {
      const t = await this.opts.client.terms();
      this.store.set({ terms: t });
      this.reportIfClosed(daysLeft(t));
    } catch (e) {
      if (e instanceof ReferralUnavailableException) this.store.set({ unavailable: e.reason });
      // Offline: the claim is still queued; the countdown and disclosure fall back.
    }
  }

  private async loadKept(): Promise<void> {
    const q = this.opts.queue;
    // A code kept from a link before sign-in: offered for one tap, like `initialCode` (already reported as opened).
    if (this.state.prefilled == null) {
      const link = await q.linkCode();
      if (link != null && isWellFormedCode(link)) this.store.set({ prefilled: link });
    }
    const code = await q.pendingCode();
    const status = await q.pendingStatus();
    if (code == null || status == null) return;
    this.store.set({
      codeKept: true,
      text: formatCode(code),
      message: { kind: status === ClaimStatus.queuedNotVerified ? 'notVerified' : 'offlineQueued' },
    });
  }

  private reportIfClosed(daysLeft: number | null): void {
    if (this.closedReported || daysLeft !== 0) return;
    this.closedReported = true;
    void this.opts.client.reportHidden('window_closed', { surface: 'entry' });
  }

  /** `code_entry_started` with [source] (`focus`, `typed`, `pasted`, `prefilled`), once. */
  startEntry(source: string): void {
    if (this.entryStarted) return;
    this.entryStarted = true;
    this.opts.emit(new ReferralEvent(ReferralEventName.codeEntryStarted, { source }));
  }

  setText(text: string): void {
    this.startEntry('typed');
    this.store.set({ text });
  }

  /** Pasted text: the code inside a link or a share message when there is one, else Flutter's formatting. */
  paste(text: string): void {
    this.startEntry('pasted');
    const found = extractInviteCode(text);
    this.store.set({ text: found ? formatCode(found) : pastedCodeText(text) });
  }

  clearPrefilled(): void {
    this.store.set({ prefilled: null });
  }

  async submit(raw: string, source = 'typed'): Promise<void> {
    const code = normaliseCode(raw);
    if (code === '' || this.state.busy) return;
    this.startEntry(source);
    this.store.set({ busy: true });
    const outcome = await this.opts.queue.claim(code, { source });
    switch (outcome.status) {
      case ClaimStatus.queuedOffline: {
        const why = outcome.unavailable;
        this.store.set({
          busy: false,
          codeKept: true,
          unavailable: why ?? this.state.unavailable,
          message: { kind: why != null ? 'notAvailableCodeKept' : 'offlineQueued' },
        });
        break;
      }
      case ClaimStatus.queuedNotVerified:
        this.store.set({ busy: false, message: { kind: 'notVerified' } });
        break;
      default: {
        const r = outcome.result!;
        this.store.set({
          busy: false,
          done: r.isOk,
          message: r.isOk ? { kind: 'claimOk' } : { kind: 'claim', result: r },
          ...(r.isOk ? {} : { prefilled: null }),
        });
      }
    }
    if (outcome.result != null && outcome.status === ClaimStatus.answered) {
      try {
        this.opts.onClaimed?.(outcome.result);
      } catch {
        // The app's callback never breaks the entry.
      }
    }
  }
}

/**
 * Days left to add a code: the server's `claim_days_left` wins; [eligibleFrom] (when the account was verified) is the
 * fallback for servers without it. Null when neither is known.
 */
export function claimDaysLeft(terms: ReferralTerms, eligibleFrom: Date | null | undefined, now: Date): number | null {
  if (terms.claimDaysLeft != null) return terms.claimDaysLeft;
  if (eligibleFrom == null) return null;
  const end = eligibleFrom.getTime() + terms.claimWindowDays * 86_400_000;
  const seconds = Math.trunc((end - now.getTime()) / 1000);
  return seconds <= 0 ? 0 : Math.trunc((seconds + 86_399) / 86_400);
}
