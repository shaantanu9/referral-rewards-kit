import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ReferralUnavailableReason,
  type ReferralKitLocalizations,
  type ReferralTexts,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { Button, LiveText, type } from '../ui/primitives';

/**
 * Renders what a component shows when referrals are unavailable (not deployed, signed out, no project). Return
 * `null` to hide the feature, or your own explanation. Without one the kit shows a plain sentence per reason (signed
 * out: with a Sign in button when the component has `onSignIn`), with no Retry button.
 */
export type ReferralUnavailableRender = (reason: ReferralUnavailableReason) => ReactNode;

/** The sentence for [reason]: the app's [texts] first, then the kit's localisation. */
export function unavailableMessage(
  l10n: ReferralKitLocalizations,
  reason: ReferralUnavailableReason,
  opts: { texts?: ReferralTexts | undefined; codeKept?: boolean } = {},
): string {
  const custom = opts.texts?.unavailable?.(reason);
  if (custom != null) return custom;
  switch (reason) {
    case ReferralUnavailableReason.signedOut:
      return l10n.signInToInvite;
    case ReferralUnavailableReason.noProject:
      return l10n.notInThisVersion;
    default:
      return opts.codeKept ? l10n.notAvailableCodeKept : l10n.notAvailable;
  }
}

export interface ReferralMessageProps {
  text: string;
  action?: string | null;
  onAction?: (() => void) | null;
  /** A plain column inside the app's own scroll view; otherwise a scroll view of its own. */
  embedded?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A sentence with an optional button (the loading-failed and unavailable states). */
export function ReferralMessage(props: ReferralMessageProps): ReactNode {
  const { theme } = useReferralKit();
  const body = (
    <>
      <LiveText testID={props.testID} style={[type.bodyLarge, { color: theme.onSurface }]}>
        {props.text}
      </LiveText>
      {props.action && props.onAction ? (
        <View style={styles.action}>
          <Button theme={theme} variant="outlined" label={props.action} onPress={props.onAction} />
        </View>
      ) : null}
    </>
  );
  if (props.embedded) return <View style={[styles.pad, props.style]}>{body}</View>;
  return <ScrollView contentContainerStyle={[styles.pad, props.style]}>{body}</ScrollView>;
}

/** The unavailable state for [reason] (Flutter `ReferralMessage.unavailable`), with Sign in when signed out. */
export function ReferralUnavailableMessage(props: {
  reason: ReferralUnavailableReason;
  texts?: ReferralTexts | undefined;
  onSignIn?: (() => void) | undefined;
  embedded?: boolean;
  codeKept?: boolean;
}): ReactNode {
  const kit = useReferralKit();
  const texts = props.texts ?? kit.texts;
  const signIn = props.reason === ReferralUnavailableReason.signedOut ? props.onSignIn : undefined;
  return (
    <ReferralMessage
      testID="referral-not-available"
      text={unavailableMessage(kit.l10n, props.reason, { texts, codeKept: props.codeKept ?? false })}
      action={signIn ? (texts?.signIn ?? kit.l10n.signIn) : null}
      onAction={signIn ?? null}
      embedded={props.embedded ?? false}
    />
  );
}

/** The unavailable state of a code entry: its title and one sentence (Sign in when signed out and [onSignIn] given). */
export function ReferralEntryUnavailable(props: {
  title: string | null;
  reason: ReferralUnavailableReason;
  texts?: ReferralTexts | undefined;
  onSignIn?: (() => void) | undefined;
  codeKept?: boolean;
}): ReactNode {
  const kit = useReferralKit();
  const texts = props.texts ?? kit.texts;
  const signIn = props.reason === ReferralUnavailableReason.signedOut ? props.onSignIn : undefined;
  return (
    <View>
      {props.title != null ? (
        <Text accessibilityRole="header" style={[type.titleMedium, styles.title, { color: kit.theme.onSurface }]}>
          {props.title}
        </Text>
      ) : null}
      <LiveText testID="referral-not-available" style={[type.bodyMedium, { color: kit.theme.onSurface }]}>
        {unavailableMessage(kit.l10n, props.reason, { texts, codeKept: props.codeKept ?? false })}
      </LiveText>
      {signIn ? (
        <View style={styles.signIn}>
          <Button theme={kit.theme} variant="outlined" label={texts?.signIn ?? kit.l10n.signIn} onPress={signIn} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  action: { marginTop: 16, alignItems: 'flex-start' },
  title: { marginBottom: 12 },
  signIn: { marginTop: 12, alignItems: 'flex-start' },
});
