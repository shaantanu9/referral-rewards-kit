# Expo demo: every React Native component on fake servers

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

Private (not published). Expo SDK 58 (React Native 0.88.1, React 19.3.0). Two tabs, "Referral kit" and "Rewards kit",
show every component of [`@myind/referral-react-native`](../../packages/referral-react-native) and
[`@myind/rewards-react-native`](../../packages/rewards-react-native) on the in-memory `FakeReferralServer` and
`FakeRewardsServer` from the cores' `/testing` entries, under a "Demo — fake server" banner. The story buttons play
the other people (a friend signs up, starts, pays; the streak breaks; a post is verified; the league week closes), so
every state is reachable. The attribution links are on, as an app gets them by default.

```bash
cd js
pnpm install
pnpm -r --filter "./packages/*" build      # the demo imports the packages' dist through Metro
cd examples/expo-demo
pnpm start          # Expo Go / a simulator
pnpm web            # in the browser (react-native-web)
pnpm typecheck      # tsc against the package sources
pnpm test           # a jest render smoke test (React Native preset, no Expo runtime)
```

Optional adapters used: `/clipboard` (expo-clipboard) and `/qrcode` (react-native-svg + react-native-qrcode-svg).
Events are logged to the console.
