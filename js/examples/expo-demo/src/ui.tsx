import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

export function Section(props: { title: string; children?: ReactNode }): ReactNode {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.title, { color: dark ? '#CAC4D0' : '#49454F' }]}>
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

export function StoryButton(props: { label: string; onPress: () => void }): ReactNode {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.story, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={styles.storyText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  story: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: '#79747E' },
  storyText: { color: '#6750A4', fontWeight: '500' },
});
