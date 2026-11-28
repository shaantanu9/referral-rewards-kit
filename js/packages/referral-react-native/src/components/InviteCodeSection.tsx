import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ReferralCopy,
  ReferralTerms,
  ReferralUnavailableException,
  type ClaimResult,
  type PendingClaimQueue,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralTexts,
  type ReferralUnavailableReason,
  type RewardLabels,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { Button, ProgressBar, type } from '../ui/primitives';
import { InviteCodeEntry } from './InviteCodeEntry';
import { ReferralEntryUnavailable, type ReferralUnavailableRender } from './ReferralMessage';

export interface InviteCodeSectionProps {
  client: ReferralClient;
  queue: PendingClaimQueue;
  appName: string;
  /** Loaded through [client] when not given. */
  terms?: ReferralTerms | null;
  labels?: RewardLabels;
  texts?: ReferralTexts;
  /** A code from a link or the install referrer: one-tap confirm (reports `invite_link_opened`). */
  initialCode?: string | null;
  /** See `InviteCodeEntry.eligibleFrom`; the server's `claim_days_left` wins. */
  eligibleFrom?: Date | null;
  onClaimed?: (result: ClaimResult) => void;
  /** The button under "Almost yours" (e.g. go to the reader). Hidden when not given. */
  onAlmostAction?: () => void;
  /** App art above the section. */
  header?: ReactNode;
  /** App art beside the headline (e.g. a "+4" sticker). */
  leading?: ReactNode;
  /** The three steps under the field (only when the friend gets a reward). Default true. */
  showSteps?: boolean;
  onEvent?: ReferralEventSink;
  renderUnavailable?: ReferralUnavailableRender;
  onSignIn?: () => void;
  pastePlatform?: string;
  clock?: () => Date;
  style?: StyleProp<ViewStyle>;
}

/**
 * The friend's side of a referral: every number comes from `referral_terms`, so nothing is promised that the server
 * does not give.
 *
 * - Open: the gift a friend's code brings (only when the friend rule gives something), the server's days left as a
 *   chip, the code field (`InviteCodeEntry`) and three steps.
 * - Code accepted: "Almost yours", a 1-of-2 progress bar, and the app's next step ([onAlmostAction]).
 * - Can't add a code (window over, or not eligible): no field, one line saying why.
 * - Not deployed / signed out: [renderUnavailable], or one sentence (Sign in with [onSignIn]).
 */
export function InviteCodeSection(props: InviteCodeSectionProps): ReactNode {
  const kit = useReferralKit();
  const { l10n, theme } = kit;
  const texts = props.texts ?? kit.texts;
  const labels = props.labels ?? kit.labels;
  const alive = useRef(true);
  const closedReported = useRef(false);
  const [terms, setTerms] = useState<ReferralTerms | null>(props.terms ?? null);
  const [loading, setLoading] = useState(props.terms == null);
  const [unavailable, setUnavailable] = useState<ReferralUnavailableReason | null>(null);
  /** The terms as they stood when the code went in (after a claim the server says no days are left). */
  const [claimedWith, setClaimedWith] = useState<ReferralTerms | null>(null);

  useEffect(() => {
    alive.current = true;
    if (props.terms == null) {
      props.client
        .terms()
        .then((t) => alive.current && setTerms(t))
        .catch((e: unknown) => {
          if (alive.current && e instanceof ReferralUnavailableException) setUnavailable(e.reason);
          // Offline: the entry still works (the code is kept); no numbers are named.
        })
        .finally(() => alive.current && setLoading(false));
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = texts?.entryTitle ?? l10n.enterCodeTitle;
  if (unavailable != null) {
    if (props.renderUnavailable) return <>{props.renderUnavailable(unavailable)}</>;
    return <ReferralEntryUnavailable title={title} reason={unavailable} texts={texts} onSignIn={props.onSignIn} />;
  }
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} accessibilityLabel={l10n.enterCodeTitle} />
      </View>
    );
  }

  const shown = claimedWith ?? terms;
  const copy = new ReferralCopy({ l10n, terms: shown ?? ReferralTerms.none, labels });
  const friendReward = shown == null ? null : copy.friendReward;
  const muted = { color: theme.onSurfaceVariant };
  const onSurface = { color: theme.onSurface };

  let body: ReactNode;
  if (claimedWith != null && friendReward != null) {
    const progress = texts?.almostProgress ?? l10n.almostProgress;
    body = (
      <>
        <Text testID="referral-almost" accessibilityRole="header" style={[type.titleMedium, onSurface]}>
          {texts?.almostTitle ?? l10n.almostTitle}
        </Text>
        <Text style={[type.bodyMedium, onSurface, styles.m8]}>
          {texts?.almostLine?.(friendReward, copy.bothGetSame) ?? copy.almostLine()}
        </Text>
        <ProgressBar value={0.5} color={theme.primary} track={theme.secondaryContainer} label={progress} style={styles.m12} />
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[type.bodySmall, muted, styles.m8]}>
          {progress}
        </Text>
        {props.onAlmostAction ? (
          <View style={[styles.start, styles.m16]}>
            <Button
              theme={theme}
              testID="referral-almost-action"
              label={texts?.almostActionLabel ?? l10n.stepStartUsing(props.appName)}
              onPress={props.onAlmostAction}
            />
          </View>
        ) : null}
      </>
    );
  } else if (shown != null && copy.cannotAddReason() != null) {
    const closed = (copy.terms.claimDaysLeft ?? 1) <= 0;
    if (closed && !closedReported.current) {
      closedReported.current = true;
      void props.client.reportHidden('window_closed', { surface: 'entry' });
    }
    const why = texts?.cannotAdd?.(closed, copy.terms.claimWindowDays) ?? copy.cannotAddReason()!;
    body = (
      <>
        <Text accessibilityRole="header" style={[type.titleMedium, onSurface]}>
          {title}
        </Text>
        <Text testID="referral-cannot-add" style={[type.bodyMedium, muted, styles.m4]}>
          {why}
        </Text>
      </>
    );
  } else {
    const headline = texts?.giftTitle?.(friendReward) ?? (friendReward == null ? title : copy.giftTitle());
    const days = shown?.claimDaysLeft ?? null;
    const deadline = shown == null || days == null || days <= 0 ? null : (texts?.deadline?.(days) ?? copy.deadline());
    const steps = texts?.steps?.(friendReward, copy.bothGetSame) ?? copy.steps({ appName: props.appName, activationStep: texts?.activationStep ?? null });
    body = (
      <>
        <View style={styles.row}>
          {props.leading != null ? <View style={styles.leading}>{props.leading}</View> : null}
          <Text testID="referral-gift-title" accessibilityRole="header" style={[type.titleMedium, onSurface, styles.flex]}>
            {headline}
          </Text>
        </View>
        {deadline != null ? (
          <View style={[styles.start, styles.m8]}>
            <ReferralDeadlineChip text={deadline} lastDay={days === 1} />
          </View>
        ) : null}
        <InviteCodeEntry
          style={styles.m12}
          client={props.client}
          queue={props.queue}
          terms={shown}
          eligibleFrom={props.eligibleFrom ?? null}
          initialCode={props.initialCode ?? null}
          labels={labels}
          onClaimed={(r) => {
            props.onClaimed?.(r);
            if (r.isOk) setClaimedWith(shown ?? ReferralTerms.none);
          }}
          {...(props.clock ? { clock: props.clock } : {})}
          {...(props.pastePlatform ? { pastePlatform: props.pastePlatform } : {})}
          // The chip shows the days left; the entry still states a closed window.
          showWindow={deadline == null}
          showTitle={false}
          {...(texts ? { texts } : {})}
          {...(props.onSignIn ? { onSignIn: props.onSignIn } : {})}
          {...(props.onEvent ? { onEvent: props.onEvent } : {})}
          {...(props.renderUnavailable ? { renderUnavailable: props.renderUnavailable } : {})}
        />
        {(props.showSteps ?? true) && friendReward != null ? (
          <View style={styles.m16}>
            <Text accessibilityRole="header" style={[type.titleSmall, onSurface]}>
              {texts?.stepsTitle ?? l10n.stepsTitle}
            </Text>
            {steps.map((step, i) => (
              <View key={i} style={[styles.row, styles.step]}>
                <View style={[styles.bullet, { backgroundColor: theme.secondaryContainer }]}>
                  <Text style={[type.labelMedium, { color: theme.onSecondaryContainer }]}>{i + 1}</Text>
                </View>
                <Text style={[type.bodyMedium, onSurface, styles.flex]}>{step}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </>
    );
  }
  return (
    <View style={props.style}>
      {props.header != null ? <View style={styles.header}>{props.header}</View> : null}
      {body}
    </View>
  );
}

/** The real days left as a chip: the secondary container normally, the error container on the last day. */
export function ReferralDeadlineChip(props: { text: string; lastDay?: boolean; style?: StyleProp<ViewStyle> }): ReactNode {
  const { theme } = useReferralKit();
  const bg = props.lastDay ? theme.errorContainer : theme.secondaryContainer;
  const fg = props.lastDay ? theme.onErrorContainer : theme.onSecondaryContainer;
  return (
    <View testID="referral-deadline" style={[styles.chip, { backgroundColor: bg }, props.style]}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={[type.labelLarge, { color: fg }]}>
        ◷
      </Text>
      <Text style={[type.labelLarge, { color: fg, flexShrink: 1 }]}>{props.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 24, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  leading: { marginRight: 12 },
  flex: { flex: 1 },
  start: { alignItems: 'flex-start' },
  header: { marginBottom: 12 },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  m12: { marginTop: 12 },
  m16: { marginTop: 16 },
  step: { alignItems: 'flex-start', marginTop: 6, gap: 12 },
  bullet: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
});
