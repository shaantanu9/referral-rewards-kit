import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ClaimStatus,
  formatCode,
  isWellFormedCode,
  normaliseCode,
  ReferralCopy,
  ReferralEvent,
  ReferralEventName,
  ReferralTerms,
  ReferralUnavailableException,
  reportReferralEvent,
  type ClaimResult,
  type PendingClaimQueue,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralTexts,
  type ReferralUnavailableReason,
  type RewardLabels,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { Button, LiveText, type } from '../ui/primitives';
import { codeTextStyle, InviteCodeText } from './InviteCodeText';
import { InviteCodePasteButton } from './InviteCodePasteButton';
import { ReferralEntryUnavailable, type ReferralUnavailableRender } from './ReferralMessage';

const DAY = 86_400_000;

export interface InviteCodeEntryProps {
  client: ReferralClient;
  queue: PendingClaimQueue;
  /** Loaded through [client] when not given. */
  terms?: ReferralTerms | null;
  /**
   * When the account became verified (e.g. supabase-js `user.email_confirmed_at`), for the countdown. The server
   * keeps its own `members.eligible_from` and always decides; without it (and without the server's
   * `claim_days_left`) no countdown is shown.
   */
  eligibleFrom?: Date | null;
  /** A code from a link or the install referrer: shown with one-tap confirm. */
  initialCode?: string | null;
  labels?: RewardLabels;
  onClaimed?: (result: ClaimResult) => void;
  clock?: () => Date;
  /** Overrides the platform for the Paste control, for tests. */
  pastePlatform?: string;
  /** The "You can add an invite code for N more days" line; the closed state always shows. Default true. */
  showWindow?: boolean;
  /** Analytics from this component; the client's `onEvent` when not given. */
  onEvent?: ReferralEventSink;
  /** Shown instead of the entry when referrals are unavailable. */
  renderUnavailable?: ReferralUnavailableRender;
  /** Replaces "Have an invite code?" (wins over `texts.entryTitle`). */
  title?: string;
  texts?: ReferralTexts;
  /** Shown as a Sign in button when the user is signed out. */
  onSignIn?: () => void;
  /** False when the app (or `InviteCodeSection`) shows its own headline. Default true. */
  showTitle?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Invite-code entry (ADR 4.2 step 3, 11.2, 11.6): a field with Paste, the claim-window countdown, the disclosure
 * sentence before confirming, a message per claim reason, and one-tap confirm for a prefilled code. Claims go through
 * [queue], so an offline or `not_verified` claim is kept and retried.
 */
export function InviteCodeEntry(props: InviteCodeEntryProps): ReactNode {
  const kit = useReferralKit();
  const { l10n, theme } = kit;
  const texts = props.texts ?? kit.texts;
  const labels = props.labels ?? kit.labels;
  const clock = props.clock ?? (() => new Date());
  const alive = useRef(true);
  const started = useRef(false);
  const closedReported = useRef(false);

  const pre = normaliseCode(props.initialCode);
  const [terms, setTerms] = useState<ReferralTerms | null>(props.terms ?? null);
  const [prefilled, setPrefilled] = useState<string | null>(isWellFormedCode(pre) ? pre : null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [codeKept, setCodeKept] = useState(false);
  const [unavailable, setUnavailable] = useState<ReferralUnavailableReason | null>(null);

  const emit = (e: ReferralEvent): void => reportReferralEvent(props.onEvent ?? props.client.onEvent, e);
  const start = (source: string): void => {
    if (started.current) return;
    started.current = true;
    emit(new ReferralEvent(ReferralEventName.codeEntryStarted, { source }));
  };

  const daysLeft = (t: ReferralTerms): number | null => {
    // The server's count wins; `eligibleFrom` is the fallback for servers without `claim_days_left`.
    if (t.claimDaysLeft != null) return t.claimDaysLeft;
    const from = props.eligibleFrom;
    if (from == null) return null;
    const ms = from.getTime() + t.claimWindowDays * DAY - clock().getTime();
    const seconds = Math.trunc(ms / 1000);
    return seconds <= 0 ? 0 : Math.floor((seconds + 86399) / 86400);
  };

  const reportIfClosed = (t: ReferralTerms): void => {
    if (closedReported.current || daysLeft(t) !== 0) return;
    closedReported.current = true;
    void props.client.reportHidden('window_closed', { surface: 'entry' });
  };

  useEffect(() => {
    alive.current = true;
    if (prefilled != null) props.client.reportLinkOpened(prefilled);
    if (terms == null) {
      props.client
        .terms()
        .then((t) => {
          if (!alive.current) return;
          setTerms(t);
          reportIfClosed(t);
        })
        .catch((e: unknown) => {
          if (alive.current && e instanceof ReferralUnavailableException) setUnavailable(e.reason);
          // Offline: the claim is still queued; the countdown and disclosure fall back.
        });
    } else {
      reportIfClosed(terms);
    }
    void (async () => {
      // A code kept from a link before sign-in: offered for one tap, like `initialCode`.
      try {
        if (prefilled == null) {
          const link = await props.queue.linkCode();
          if (alive.current && link != null && isWellFormedCode(link)) setPrefilled(link);
        }
        const code = await props.queue.pendingCode();
        const status = await props.queue.pendingStatus();
        if (!alive.current || code == null || status == null) return;
        setCodeKept(true);
        setText(formatCode(code));
        setMessage(status === ClaimStatus.queuedNotVerified ? l10n.errNotVerified : l10n.offlineQueued);
      } catch {
        // Storage failed: nothing kept to show.
      }
    })();
    return () => {
      alive.current = false;
    };
    // Mount only, like Flutter's initState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (raw: string, source = 'typed'): Promise<void> => {
    const code = normaliseCode(raw);
    if (code === '' || busy) return;
    start(source);
    setBusy(true);
    const outcome = await props.queue.claim(code, { source });
    if (!alive.current) return;
    const copy = new ReferralCopy({ l10n, terms: terms ?? ReferralTerms.none, labels });
    setBusy(false);
    switch (outcome.status) {
      case ClaimStatus.queuedOffline:
        setCodeKept(true);
        if (outcome.unavailable != null) setUnavailable(outcome.unavailable);
        setMessage(outcome.unavailable != null ? l10n.notAvailableCodeKept : l10n.offlineQueued);
        break;
      case ClaimStatus.queuedNotVerified:
        setMessage(l10n.errNotVerified);
        break;
      default: {
        const r = outcome.result!;
        setDone(r.isOk);
        setMessage(r.isOk ? l10n.claimOk : copy.claimMessage(r));
        if (!r.isOk) setPrefilled(null);
      }
    }
    if (outcome.result != null && outcome.status === ClaimStatus.answered) props.onClaimed?.(outcome.result);
  };

  const title = props.title ?? texts?.entryTitle ?? l10n.enterCodeTitle;
  const showTitle = props.showTitle ?? true;
  if (unavailable != null) {
    if (props.renderUnavailable) return <>{props.renderUnavailable(unavailable)}</>;
    return (
      <ReferralEntryUnavailable
        title={showTitle ? title : null}
        reason={unavailable}
        texts={texts}
        onSignIn={props.onSignIn}
        codeKept={codeKept}
      />
    );
  }

  const t = terms ?? ReferralTerms.none;
  const copy = new ReferralCopy({ l10n, terms: t, labels });
  const left = daysLeft(t);
  const closed = left === 0;
  // Before terms load, name both events: never say less than the server may do.
  const disclosure = terms == null ? l10n.friendDisclosureBoth : copy.friendDisclosure();
  const body = [type.bodyMedium, { color: theme.onSurface }];

  return (
    <View style={[styles.col, props.style]}>
      {showTitle ? (
        <Text accessibilityRole="header" style={[type.titleMedium, { color: theme.onSurface }]}>
          {title}
        </Text>
      ) : null}
      {left != null && (closed || (props.showWindow ?? true)) ? (
        <Text testID="referral-window" style={[body, styles.window]}>
          {closed ? l10n.windowOver(t.claimWindowDays) : l10n.windowCountdown(left)}
        </Text>
      ) : null}
      {!closed && !done && prefilled != null ? (
        <>
          <InviteCodeText code={prefilled} style={styles.gap} />
          {disclosure != null ? (
            <Text testID="referral-disclosure" style={[body, styles.gap]}>
              {disclosure}
            </Text>
          ) : null}
          <View style={[styles.buttons, styles.gap]}>
            <Button
              theme={theme}
              testID="referral-use-code"
              label={l10n.useCode(formatCode(prefilled))}
              disabled={busy}
              onPress={() => void submit(prefilled, 'prefilled')}
            />
            <Button theme={theme} variant="text" label={l10n.enterDifferentCode} disabled={busy} onPress={() => setPrefilled(null)} />
          </View>
        </>
      ) : null}
      {!closed && !done && prefilled == null ? (
        <>
          <TextInput
            testID="referral-code-field"
            accessibilityLabel={l10n.codeFieldLabel}
            placeholder={l10n.codeFieldLabel}
            placeholderTextColor={theme.onSurfaceVariant}
            value={text}
            editable={!busy}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            onFocus={() => start('focus')}
            onChangeText={(v) => {
              start('typed');
              setText(v);
            }}
            onSubmitEditing={() => void submit(text)}
            returnKeyType="done"
            style={[codeTextStyle(theme.onSurface, 22), styles.field, { borderColor: theme.outline }]}
          />
          {disclosure != null ? (
            <Text testID="referral-disclosure" style={[body, styles.gap]}>
              {disclosure}
            </Text>
          ) : null}
          <View style={[styles.buttons, styles.gap]}>
            <Button theme={theme} testID="referral-add-code" label={l10n.addCode} disabled={busy} onPress={() => void submit(text)} />
            <InviteCodePasteButton
              {...(props.pastePlatform ? { platform: props.pastePlatform } : {})}
              onPasted={(pasted) => {
                start('pasted');
                setText(formatCode(normaliseCode(pasted)));
              }}
            />
          </View>
        </>
      ) : null}
      {message != null ? (
        <LiveText testID="referral-message" style={[body, styles.gap]}>
          {message}
        </LiveText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignSelf: 'stretch' },
  window: { marginTop: 4 },
  gap: { marginTop: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  field: { marginTop: 12, borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56, writingDirection: 'ltr' },
});
