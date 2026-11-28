/**
 * Small building blocks of the default look, from the core's `RewardsTheme` tokens: the card, buttons with 44 pt
 * targets, a linear bar, a ring, and the reduced-motion setting. Internal: apps restyle through `style`, the theme,
 * or a component's `render` prop.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { RewardsTextStyle, RewardsTheme } from '@myind/rewards-core';

export const minTarget = 44;

/** A theme text style token as a React Native style. */
export function textStyle(s: RewardsTextStyle, color?: string): TextStyle {
  return { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: String(s.fontWeight) as TextStyle['fontWeight'], ...(color ? { color } : {}) };
}

/** `#RRGGBB` with an alpha 0..1 → `rgba(…)` (the Flutter `withValues(alpha:)`). Other colour strings pass through. */
export function alpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function cardStyle(t: RewardsTheme): ViewStyle {
  return { backgroundColor: t.surface, borderRadius: t.radius, padding: t.padding };
}

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

export function Button(props: {
  label: string;
  onPress?: (() => void) | null;
  variant?: ButtonVariant;
  disabled?: boolean;
  theme: RewardsTheme;
  icon?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const { theme: t, variant = 'filled' } = props;
  const disabled = props.disabled === true || props.onPress == null;
  const bg = variant === 'filled' ? t.accent : variant === 'tonal' ? alpha(t.accent, 0.15) : 'transparent';
  const fg = variant === 'filled' ? t.onAccent : variant === 'tonal' ? t.onSurface : t.accent;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => props.onPress?.()}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        variant === 'outlined' && { borderWidth: 1, borderColor: t.muted },
        variant === 'text' && styles.textButton,
        props.style,
      ]}
    >
      <View style={styles.row}>
        {typeof props.icon === 'string' ? (
          <Text style={[textStyle(t.bodyStyle, fg), styles.medium]} accessibilityElementsHidden importantForAccessibility="no">
            {props.icon}
          </Text>
        ) : (
          (props.icon ?? null)
        )}
        <Text style={[textStyle(t.bodyStyle, fg), styles.medium]}>{props.label}</Text>
      </View>
    </Pressable>
  );
}

/** A determinate bar; [value] 0..1. */
export function ProgressBar(props: { value: number; color: string; track: string; height?: number; label?: string; testID?: string }): ReactNode {
  const v = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  const h = props.height ?? 8;
  return (
    <View
      testID={props.testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height: h, borderRadius: h / 2, backgroundColor: props.track, overflow: 'hidden', alignSelf: 'stretch' }}
    >
      <View style={{ width: `${v * 100}%`, height: h, backgroundColor: props.color, borderRadius: h / 2 }} />
    </View>
  );
}

/**
 * A circular progress ring drawn with plain views (no SVG): [segments] short arcs around the circle, the first
 * `value × segments` in [color], the rest in [track], with [children] in the middle.
 */
export function Ring(props: {
  value: number;
  size: number;
  stroke: number;
  color: string;
  track: string;
  segments?: number;
  children?: ReactNode;
}): ReactNode {
  const { size, stroke } = props;
  const n = props.segments ?? 48;
  const v = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  const filled = Math.round(v * n);
  const r = size / 2 - stroke / 2;
  const arc = Math.max(1, ((2 * Math.PI * r) / n) * 0.9);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: n }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: size / 2 - arc / 2,
            top: size / 2 - stroke / 2,
            width: arc,
            height: stroke,
            borderRadius: stroke / 2,
            backgroundColor: i < filled ? props.color : props.track,
            transform: [{ rotate: `${(i + 0.5) * (360 / n)}deg` }, { translateY: -r }],
          }}
        />
      ))}
      {props.children}
    </View>
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
  medium: { fontWeight: '500' },
});
