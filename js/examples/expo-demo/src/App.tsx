import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ReferralKitProvider } from '@myind/referral-react-native';
import { expoClipboard } from '@myind/referral-react-native/clipboard';
import { qrCodeSvg } from '@myind/referral-react-native/qrcode';
import { RewardsKitProvider } from '@myind/rewards-react-native';
import { expoCopyText } from '@myind/rewards-react-native/clipboard';
import { ReferralDemo } from './ReferralDemo';
import { RewardsDemo } from './RewardsDemo';

type Tab = 'referral' | 'rewards';

/** The demo shell: a "Demo — fake server" banner, a tab per package, and every component below. */
export default function App(): ReactNode {
  const [tab, setTab] = useState<Tab>('referral');
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#141218' : '#FEF7FF';
  const fg = dark ? '#E6E0E9' : '#1D1B20';
  return (
    <ReferralKitProvider clipboard={expoClipboard} renderQr={qrCodeSvg}>
      <RewardsKitProvider copyText={expoCopyText}>
        <View style={[styles.flex, { backgroundColor: bg, paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : Platform.OS === 'ios' ? 50 : 0 }]}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <View testID="demo-banner" style={styles.banner} accessibilityRole="alert">
            <Text style={styles.bannerText}>Demo — fake server</Text>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(['referral', 'rewards'] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => setTab(t)}
                style={[styles.tab, tab === t && styles.tabOn]}
              >
                <Text style={{ color: fg, fontWeight: tab === t ? '700' : '400' }}>{t === 'referral' ? 'Referral kit' : 'Rewards kit'}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.flex} contentContainerStyle={styles.bottom}>
            {tab === 'referral' ? <ReferralDemo /> : <RewardsDemo />}
          </ScrollView>
        </View>
      </RewardsKitProvider>
    </ReferralKitProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { backgroundColor: '#FFD8E4', paddingVertical: 6, alignItems: 'center' },
  bannerText: { color: '#31111D', fontWeight: '600' },
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: '#6750A4' },
  bottom: { paddingBottom: 48 },
});
