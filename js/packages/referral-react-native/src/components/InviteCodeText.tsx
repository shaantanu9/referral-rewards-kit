import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { normaliseCode, spellCode } from '@myind/referral-core';
import { useReferralKit } from '../context';
import { monoFont } from '../ui/primitives';

/** Monospace style for codes (the Flutter `codeTextStyle`). */
export function codeTextStyle(color: string, fontSize = 28): TextStyle {
  return { fontFamily: monoFont, fontSize, lineHeight: Math.round(fontSize * 1.3), fontWeight: '600', letterSpacing: 2, color };
}

export interface InviteCodeTextProps {
  code: string;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/**
 * A code shown as `ABCD-EFGH` in large monospace (ADR 4.1, 11.5): always left to right and ASCII, read out one letter
 * at a time, and wrapped onto two lines at large text sizes instead of being shrunk.
 */
export function InviteCodeText({ code, fontSize = 28, style, textStyle }: InviteCodeTextProps): ReactNode {
  const { theme } = useReferralKit();
  const c = normaliseCode(code);
  const halves = c.length === 8 ? [`${c.substring(0, 4)}-`, c.substring(4)] : [c];
  return (
    <View accessible accessibilityLabel={spellCode(c)} style={[styles.wrap, style]}>
      {halves.map((h) => (
        <Text key={h} testID={`referral-code-${h}`} style={[codeTextStyle(theme.onSurface, fontSize), { writingDirection: 'ltr' }, textStyle]}>
          {h}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', direction: 'ltr' },
});
