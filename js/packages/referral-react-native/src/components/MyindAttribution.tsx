import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { attributionLink } from '@myind/referral-core';
import { useReferralKit } from '../context';
import { minTarget } from '../ui/primitives';

/** `utm_source` of the link when the app does not set one. */
export const referralAttributionSource = 'referral-react-native';

export interface MyindAttributionProps {
  /** Which text and URL (wraps over the 4 variants). Default 0: "Built with Myind referral kit". */
  variant?: number;
  /** `utm_source` on the opened link. */
  source?: string;
  /** Opens the link; default the provider's launcher (`Linking`). */
  onOpen?: (url: string) => unknown;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}

/**
 * A small centred "Built with Myind referral kit" link (ADR 0003). `InviteHub` and `InviteFriendsScreen` show it at
 * the bottom of their content; `showAttribution={false}` hides it there. Opens the site with `utm_source`,
 * `utm_medium=attribution` and `utm_campaign=v<variant>`. Nothing is sent at runtime.
 */
export function MyindAttribution(props: MyindAttributionProps): ReactNode {
  const kit = useReferralKit();
  const link = attributionLink(props.variant ?? 0, props.source ?? referralAttributionSource);
  const open = (): void => {
    try {
      const r = props.onOpen ? props.onOpen(link.url) : kit.launcher.launch(link.url);
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      // Opening a link never breaks the screen.
    }
  };
  return (
    <Pressable
      testID="myind-attribution"
      accessibilityRole="link"
      accessibilityLabel={link.label}
      onPress={open}
      style={({ pressed }) => [styles.box, { opacity: pressed ? 0.6 : 1 }, props.style]}
    >
      <Text style={[styles.text, { color: kit.theme.onSurfaceVariant }, props.textStyle]}>{link.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'center', minHeight: minTarget, minWidth: minTarget, paddingVertical: 8, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 8 },
  text: { fontSize: 11, lineHeight: 16, opacity: 0.8, textAlign: 'center' },
});
