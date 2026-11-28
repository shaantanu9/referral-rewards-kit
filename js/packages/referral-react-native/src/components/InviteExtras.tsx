import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { ReferralCopy, type ReferralTerms } from '@myind/referral-core';
import { useReferralKit } from '../context';
import type { QrRenderer } from '../platform';
import { Button, type } from '../ui/primitives';

/**
 * The boost banner (G8): "Double rewards until Sun, 22 Nov for every friend who adds your code by then." The real last
 * day from the server's `ends_at`, in the user's locale; never a ticking timer. Nothing when [terms] has no boost or
 * it has ended at [clock]'s now. Colours: the tertiary container.
 */
export function ReferralBoostBanner(props: { terms: ReferralTerms; clock?: () => Date; style?: StyleProp<ViewStyle> }): ReactNode {
  const { l10n, theme } = useReferralKit();
  const text = new ReferralCopy({ l10n, terms: props.terms }).boostLine((props.clock ?? (() => new Date()))());
  if (text == null) return null;
  return (
    <View testID="referral-boost" style={[styles.boost, { backgroundColor: theme.tertiaryContainer }, props.style]}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={[type.bodyMedium, { color: theme.onTertiaryContainer }]}>
        ⚡︎
      </Text>
      <Text style={[type.bodyMedium, styles.flex, { color: theme.onTertiaryContainer }]}>{text}</Text>
    </View>
  );
}

export interface ReferralQrSheetProps {
  /** The https invite link (never an unlock token or a code to redeem, Apple 3.1.1). */
  link: string;
  visible: boolean;
  onClose: () => void;
  /** Draws the code; default the provider's `renderQr`. */
  renderQr?: QrRenderer;
}

/**
 * The "Show QR code" sheet for an invite link (G6): the code with a short hint and the link itself. The code is
 * always dark on white with a quiet zone, so it scans in dark mode too. `InviteFriendsScreen` opens it and reports
 * `invite_qr_shown`.
 */
export function ReferralQrSheet(props: ReferralQrSheetProps): ReactNode {
  const { l10n, theme, renderQr } = useReferralKit();
  const { width } = useWindowDimensions();
  const size = Math.max(120, Math.min(240, width - 96));
  const draw = props.renderQr ?? renderQr;
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { backgroundColor: theme.card }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text accessibilityRole="header" style={[type.titleLarge, styles.center, { color: theme.onSurface }]}>
              {l10n.qrTitle}
            </Text>
            <View testID="referral-qr" style={[styles.qrBox, { padding: 16 }]} accessible accessibilityRole="image" accessibilityLabel={l10n.qrSemantics}>
              {draw ? draw({ value: props.link, size, label: l10n.qrSemantics }) : null}
            </View>
            <Text style={[type.bodyMedium, styles.center, { color: theme.onSurface }]}>{l10n.qrHint}</Text>
            <Text selectable style={[type.bodySmall, styles.center, styles.link, { color: theme.onSurfaceVariant }]}>
              {props.link}
            </Text>
            <View style={styles.close}>
              <Button theme={theme} variant="text" label={l10n.close} onPress={props.onClose} testID="referral-qr-close" />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  boost: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  flex: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%' },
  sheetBody: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, gap: 16 },
  center: { textAlign: 'center' },
  qrBox: { alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 12 },
  link: { writingDirection: 'ltr' },
  close: { alignItems: 'center' },
});
