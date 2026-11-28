/**
 * Small building blocks of the default look: buttons with 44 pt targets, a linear progress bar, text sizes after
 * Material 3's type scale, and the reduced-motion setting. Internal: apps restyle through `style` props, the theme, or
 * replace a component's body with its `render` prop.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { ReferralTheme } from './theme';

export const type = StyleSheet.create({
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '400' },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  titleSmall: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  bodyLarge: { fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontSize: 14, lineHeight: 20 },
  bodySmall: { fontSize: 12, lineHeight: 16 },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
});

/** A monospace family per platform, for codes. */
export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** The smallest touch target (Apple HIG 44 pt; Material asks 48 dp, so buttons also get 48 of height on Android). */
export const minTarget = 44;

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

export function Button(props: {
  label: string;
  onPress?: (() => void) | null;
  variant?: ButtonVariant;
  disabled?: boolean;
  theme: ReferralTheme;
  /** A small glyph before the label (decorative, hidden from screen readers). */
  icon?: string;
  /** Text colour of a `text` / `outlined` button (e.g. the error colour for "Leave"). */
  color?: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const { theme: t, variant = 'filled' } = props;
  const disabled = props.disabled === true || props.onPress == null;
  const bg = variant === 'filled' ? t.primary : variant === 'tonal' ? t.secondaryContainer : 'transparent';
  const fg =
    variant === 'filled' ? t.onPrimary : variant === 'tonal' ? t.onSecondaryContainer : (props.color ?? t.primary);
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => props.onPress?.()}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        variant === 'outlined' && { borderWidth: 1, borderColor: t.outline },
        variant === 'text' && styles.textButton,
        props.style,
      ]}
    >
      <View style={styles.row}>
        {props.icon ? (
          <Text style={[type.labelLarge, { color: fg }]} accessibilityElementsHidden importantForAccessibility="no">
            {props.icon}
          </Text>
        ) : null}
        <Text style={[type.labelLarge, { color: fg }]}>{props.label}</Text>
      </View>
    </Pressable>
  );
}

/** A determinate bar; [value] 0..1. Announced as a progress bar with its percentage and [label]. */
export function ProgressBar(props: {
  value: number;
  color: string;
  track: string;
  height?: number;
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const v = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  const h = props.height ?? 8;
  return (
    <View
      testID={props.testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[{ height: h, borderRadius: h / 2, backgroundColor: props.track, overflow: 'hidden' }, props.style]}
    >
      <View style={{ width: `${v * 100}%`, height: h, backgroundColor: props.color, borderRadius: h / 2 }} />
    </View>
  );
}

/** Live region text: read out by screen readers when it changes (Android `polite`; iOS via [announce]). */
export function LiveText(props: { children: string; style?: StyleProp<TextStyle>; testID?: string }): ReactNode {
  return (
    <Text testID={props.testID} accessibilityLiveRegion="polite" style={props.style}>
      {props.children}
    </Text>
  );
}

/** Speaks [text] through VoiceOver / TalkBack. */
export function announce(text: string): void {
  try {
    AccessibilityInfo.announceForAccessibility(text);
  } catch {
    // No screen reader API (tests, web).
  }
}

/** The system's "Reduce motion" setting, kept up to date. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(v));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  button: {
    minHeight: Platform.OS === 'android' ? 48 : minTarget,
    minWidth: minTarget,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: { paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
