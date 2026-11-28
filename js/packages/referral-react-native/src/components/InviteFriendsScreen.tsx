import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  formatCode,
  inviteShareText,
  MyCodeResult,
  ReferralCopy,
  ReferralEvent,
  ReferralEventName,
  ReferralStats,
  ReferralTerms,
  ReferralUnavailableException,
  reportReferralEvent,
  resolveInviteLink,
  shareEventProps,
  whatsAppShareUri,
  type InviteLinkBuilder,
  type KeyValueStore,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralLauncher,
  type ReferralPreferences,
  type ReferralTexts,
  type RewardLabels,
  type ShareHandler,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import type { QrRenderer, ReferralClipboard } from '../platform';
import { announce, Button, LiveText, type } from '../ui/primitives';
import { InviteCodeText } from './InviteCodeText';
import { ReferralBoostBanner, ReferralQrSheet } from './InviteExtras';
import { MyindAttribution } from './MyindAttribution';
import { ReferralInvitePageSettings } from './ReferralInvitePageSettings';
import { ReferralMessage, ReferralUnavailableMessage, type ReferralUnavailableRender } from './ReferralMessage';

export interface InviteFriendsScreenProps {
  client: ReferralClient;
  appName: string;
  /** The invite page link for a code, e.g. `(c) => \`https://example.com/i/${c}\``. None (or null) while the app has no invite page: Share then sends the code and [storeLink]. */
  inviteLink?: InviteLinkBuilder;
  /** The app's store page, shared with the code when there is no invite link. */
  storeLink?: string;
  labels?: RewardLabels;
  /** Opens the program terms page; the link is hidden when not given. */
  onOpenTerms?: () => void;
  /** The share sheet; default the provider's (React Native `Share`). */
  share?: ShareHandler;
  /** Keeps the last code so it can still be shared offline (ADR 11.6). */
  codeCache?: KeyValueStore;
  /** A title bar with the screen's title. False when the app's navigator shows its own header. Default true. */
  showAppBar?: boolean;
  /** Shown above the code (the app's own picture and headline). */
  header?: ReactNode;
  /** The app's share sentence for a code and its link. Keep it as honest as the default. */
  shareText?: (code: string, link: string) => string;
  onEvent?: ReferralEventSink;
  /** Shown instead of the body when referrals are unavailable. */
  renderUnavailable?: ReferralUnavailableRender;
  /** A plain column with no title bar, to sit in the app's own scroll view (as in `InviteHub`). Default false. */
  embedded?: boolean;
  /** Called after each load finishes, whether it worked or not. */
  onLoaded?: () => void;
  /** Called after the code was copied (formatted `ABCD-EFGH`). */
  onCopied?: (code: string) => void;
  /** Where the app opened this screen from, for `invite_screen_viewed` (not reported when [embedded]). */
  from?: string;
  texts?: ReferralTexts;
  /** Shown as a Sign in button when the user is signed out. */
  onSignIn?: () => void;
  /** Opens the WhatsApp link; default the provider's (`Linking`). */
  launcher?: ReferralLauncher;
  /** The WhatsApp button next to Share (`https://wa.me/?text=…`). Hidden anyway when the device cannot open it. Default true. */
  showWhatsApp?: boolean;
  /** "Show QR code" for the https invite link (needs a QR renderer). Default true. */
  showQrCode?: boolean;
  /** "Your invite page" (first name on the page, leave the program). Default true. */
  showInvitePageSettings?: boolean;
  /** Now, for the boost banner. */
  clock?: () => Date;
  /** The small "Built with Myind" link at the bottom. Free to turn off. Default true. */
  showAttribution?: boolean;
  /** Which link text. Default 0. */
  attributionVariant?: number;
  /** Copy; default the provider's. Without one the Copy button is hidden. */
  clipboard?: ReferralClipboard;
  /** Draws the QR code; default the provider's. */
  renderQr?: QrRenderer;
  style?: StyleProp<ViewStyle>;
}

interface Data {
  code: MyCodeResult;
  terms: ReferralTerms;
  stats: ReferralStats;
  offline: boolean;
  prefs: ReferralPreferences | null;
}

type Load = { kind: 'loading' } | { kind: 'error'; error: unknown } | { kind: 'done'; data: Data };

const cacheKey = 'my_code';

/**
 * The "Invite friends" screen (ADR 4.1): the code, Share, Copy, the rules with their conditions, caps, joined count,
 * rewards earned, pending rewards with dates, the terms link, and the empty and paused states. Every sentence comes
 * from `referral_terms()` through `ReferralCopy` (or the app's [texts]).
 *
 * Growth (0.5): a give-first headline, the boost banner while a boost runs, WhatsApp next to Share, "Show QR code",
 * the waiting line, and "Your invite page". After leaving: "You left the invite program" with "Join again".
 */
export function InviteFriendsScreen(props: InviteFriendsScreenProps): ReactNode {
  const kit = useReferralKit();
  const { l10n, theme } = kit;
  const texts = props.texts ?? kit.texts;
  const labels = props.labels ?? kit.labels;
  const share = props.share ?? kit.share;
  const launcher = props.launcher ?? kit.launcher;
  const clipboard = props.clipboard ?? kit.clipboard;
  const renderQr = props.renderQr ?? kit.renderQr;
  const clock = props.clock ?? (() => new Date());
  const showWhatsApp = props.showWhatsApp ?? true;
  const embedded = props.embedded ?? false;

  const alive = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [whatsApp, setWhatsApp] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const emit = (e: ReferralEvent): void => reportReferralEvent(props.onEvent ?? props.client.onEvent, e);
  const link = (code: string): string | null => resolveInviteLink(props.inviteLink, code);

  const loadData = async (): Promise<Data> => {
    try {
      // Loaded with the rest, so the block's height is known before an InviteHub scrolls to its code entry.
      const prefs = (props.showInvitePageSettings ?? true)
        ? props.client.preferences().then(
            (p): ReferralPreferences | null => p,
            () => null,
          )
        : Promise.resolve(null);
      const [code, terms, stats] = await Promise.all([props.client.myCode(), props.client.terms(), props.client.stats()]);
      if (code.code != null) await props.codeCache?.setString(cacheKey, code.code);
      // Left the program: no cached code may be shared offline either.
      if (code.left) await props.codeCache?.remove(cacheKey);
      return { code, terms, stats, offline: false, prefs: await prefs };
    } catch (e) {
      // Not deployed or signed out: a cached code would promise something the server cannot do.
      if (e instanceof ReferralUnavailableException) throw e;
      const cached = await props.codeCache?.getString(cacheKey);
      if (cached == null) throw e;
      return {
        code: new MyCodeResult({ code: cached, reason: 'ok' }),
        terms: ReferralTerms.none,
        stats: ReferralStats.empty,
        offline: true,
        prefs: null,
      };
    }
  };

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    void (async () => {
      let next: Load;
      try {
        const d = await loadData();
        const paused = !d.terms.enabled || d.code.reason === 'program_paused';
        if (paused || d.code.reason === 'code_disabled') {
          void props.client.reportHidden(paused ? 'program_paused' : 'code_disabled', { surface: 'invite' });
        } else if (d.code.code != null && link(d.code.code) == null) {
          void props.client.reportHidden('no_invite_url', { surface: 'invite' });
        }
        next = { kind: 'done', data: d };
      } catch (e) {
        next = { kind: 'error', error: e };
      }
      if (alive.current) setState(next);
      try {
        props.onLoaded?.();
      } catch {
        // The app's callback failed; the screen keeps working.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client]);

  useEffect(() => {
    alive.current = true;
    if (!embedded) {
      emit(new ReferralEvent(ReferralEventName.inviteScreenViewed, { from: props.from ?? 'unknown', focus: 'share' }));
    }
    reload();
    return () => {
      alive.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showWhatsApp) return;
    let on = true;
    launcher
      .canLaunch(whatsAppShareUri(''))
      .catch(() => false)
      .then((ok) => on && setWhatsApp(ok));
    return () => {
      on = false;
    };
  }, [launcher, showWhatsApp]);

  const showToast = (text: string): void => {
    announce(text);
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => alive.current && setToast(null), 3000);
  };

  const copy = async (code: string): Promise<void> => {
    if (!clipboard) return;
    const shown = formatCode(code);
    try {
      await clipboard.setString(shown);
    } catch {
      return;
    }
    emit(new ReferralEvent(ReferralEventName.inviteCodeCopied, { has_link: link(code) != null }));
    props.onCopied?.(shown);
    if (alive.current) showToast(l10n.codeCopied);
  };

  const shareTextFor = (c: ReferralCopy, code: string): string =>
    inviteShareText({
      copy: c,
      appName: props.appName,
      code,
      link: link(code),
      storeLink: props.storeLink ?? null,
      ...(props.shareText ? { shareText: props.shareText } : {}),
      ...(texts?.shareTextNoLink ? { shareTextNoLink: texts.shareTextNoLink } : {}),
    });

  const doShare = async (c: ReferralCopy, code: string): Promise<void> => {
    let result: unknown = null;
    try {
      result = await share(shareTextFor(c, code), null);
    } catch {
      result = null;
    }
    emit(new ReferralEvent(ReferralEventName.inviteShared, shareEventProps(result, { hasLink: link(code) != null })));
  };

  // WhatsApp opens with the share text typed in; the user picks the chat and sends it (G5).
  const shareWhatsApp = async (c: ReferralCopy, code: string): Promise<void> => {
    let opened = false;
    try {
      opened = await launcher.launch(whatsAppShareUri(shareTextFor(c, code)));
    } catch {
      opened = false;
    }
    emit(
      new ReferralEvent(ReferralEventName.inviteShared, {
        channel: 'whatsapp_button',
        status: opened ? 'opened' : 'unavailable',
        has_link: link(code) != null,
      }),
    );
  };

  const rejoin = async (): Promise<void> => {
    let result = 'failed';
    try {
      const p = await props.client.setPreferences({ participating: true });
      result = p.reason ?? 'ok';
    } catch {
      // Shown below.
    }
    emit(new ReferralEvent(ReferralEventName.invitePreferencesChanged, { participating: true, result }));
    if (!alive.current) return;
    if (result === 'ok') reload();
    else showToast(l10n.saveFailed);
  };

  let body: ReactNode;
  if (state.kind === 'loading') {
    body = (
      <View style={embedded ? styles.spinnerEmbedded : styles.spinner}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  } else if (state.kind === 'error') {
    const e = state.error;
    if (e instanceof ReferralUnavailableException) {
      body = props.renderUnavailable ? (
        props.renderUnavailable(e.reason)
      ) : (
        <ReferralUnavailableMessage reason={e.reason} texts={texts} onSignIn={props.onSignIn} embedded={embedded} />
      );
    } else {
      body = <ReferralMessage text={l10n.loadFailed} action={l10n.retry} onAction={reload} embedded={embedded} />;
    }
  } else {
    body = content(state.data);
  }

  function content(d: Data): ReactNode {
    const c = new ReferralCopy({ l10n, terms: d.terms, labels });
    const muted = [type.bodyMedium, { color: theme.onSurfaceVariant }];
    const onSurface = { color: theme.onSurface };
    const paused = !d.terms.enabled || d.code.reason === 'program_paused';
    const code = d.code.code;
    const l = code == null ? null : link(code);
    const out: ReactNode[] = [];
    const add = (key: string, node: ReactNode): void => {
      out.push(
        <View key={key} style={out.length === 0 ? null : styles.gap}>
          {node}
        </View>,
      );
    };
    if (props.header != null && !paused) add('header', props.header);
    if (paused) {
      add(
        'paused',
        <Text testID="referral-paused" accessibilityRole="header" style={[type.titleMedium, onSurface]}>
          {l10n.paused}
        </Text>,
      );
    } else if (d.code.left) {
      add(
        'left',
        <>
          <Text testID="referral-left" accessibilityRole="header" style={[type.titleMedium, onSurface]}>
            {l10n.leftTitle}
          </Text>
          <Text style={[muted, styles.m8]}>{l10n.leftBody}</Text>
          <View style={[styles.start, styles.gap]}>
            <Button theme={theme} testID="referral-join-again" label={l10n.joinAgain} onPress={() => void rejoin()} />
          </View>
        </>,
      );
    } else if (code == null) {
      add(
        'unavailable',
        <Text testID="referral-unavailable" accessibilityRole="header" style={[type.titleMedium, onSurface]}>
          {d.code.reason === 'code_disabled' ? l10n.codeDisabled : l10n.errUnavailable}
        </Text>,
      );
    } else {
      const headline = texts?.inviteHeadline?.(c.friendReward, c.sharerJoinedReward) ?? c.inviteHeadline();
      if (!d.offline && d.terms.boostAt(clock()) != null) add('boost', <ReferralBoostBanner terms={d.terms} clock={clock} />);
      if (headline != null && !d.offline) {
        add(
          'headline',
          <Text testID="referral-invite-headline" accessibilityRole="header" style={[type.titleMedium, onSurface, styles.center]}>
            {headline}
          </Text>,
        );
      }
      add(
        'code',
        <>
          <Text style={[type.labelLarge, onSurface, styles.center]}>{l10n.yourCode}</Text>
          <InviteCodeText code={code} style={styles.m8} />
        </>,
      );
      add(
        'buttons',
        <>
          <View style={styles.buttons}>
            <Button theme={theme} testID="referral-share" icon="⇪" label={l10n.share} onPress={() => void doShare(c, code)} />
            {whatsApp && showWhatsApp ? (
              <Button theme={theme} variant="outlined" testID="referral-whatsapp" label={l10n.whatsApp} onPress={() => void shareWhatsApp(c, code)} />
            ) : null}
            {clipboard ? (
              <Button theme={theme} variant="outlined" testID="referral-copy-code" icon="⧉" label={l10n.copyCode} onPress={() => void copy(code)} />
            ) : null}
          </View>
          {toast != null ? (
            <LiveText testID="referral-toast" style={[muted, styles.center, styles.m8]}>
              {toast}
            </LiveText>
          ) : null}
          {l != null && (props.showQrCode ?? true) && renderQr ? (
            <View style={[styles.centerBox, styles.m8]}>
              <Button
                theme={theme}
                variant="text"
                testID="referral-show-qr"
                label={l10n.showQr}
                onPress={() => {
                  emit(new ReferralEvent(ReferralEventName.inviteQrShown));
                  setQrOpen(true);
                }}
              />
            </View>
          ) : null}
          {l == null ? (
            <Text testID="referral-no-link" style={[muted, styles.center, styles.m8]}>
              {texts?.noLinkHint?.(props.appName) ?? l10n.noLinkHint(props.appName)}
            </Text>
          ) : null}
          {l != null ? <ReferralQrSheet link={l} visible={qrOpen} onClose={() => setQrOpen(false)} {...(renderQr ? { renderQr } : {})} /> : null}
        </>,
      );
      const lines = [...c.rules(), ...c.caps()];
      if (lines.length > 0) {
        add(
          'rules',
          lines.map((line, i) => (
            <Text key={i} style={[type.bodyLarge, onSurface, styles.line]}>
              {line}
            </Text>
          )),
        );
      }
    }

    const s = d.stats;
    if (!paused && code != null && s.isEmpty && !d.offline) {
      add('empty', <Text testID="referral-empty" style={[type.bodyMedium, onSurface]}>{c.emptyState()}</Text>);
    }
    const joined = s.joinedCount ?? 0;
    if (joined > 0) add('joined', <Text testID="referral-joined" style={[type.bodyMedium, onSurface]}>{l10n.joinedCount(joined)}</Text>);
    const claimed = s.claimedCount ?? 0;
    if (claimed > 0 && !paused) {
      const step = texts?.activationStepForFriends ?? texts?.activationStep ?? null;
      const line =
        texts?.waiting?.(claimed, c.nextStep({ appName: props.appName, activationStep: step }), c.sharerJoinedReward, c.friendReward) ??
        c.waitingLine(claimed, { appName: props.appName, activationStep: step })!;
      add('claimed', <Text testID="referral-claimed" style={[type.bodyMedium, onSurface]}>{line}</Text>);
    }
    if (s.rewardsGranted.length > 0) {
      add(
        'earned',
        <>
          <Text accessibilityRole="header" style={[type.titleSmall, onSurface]}>
            {l10n.rewardsEarned}
          </Text>
          {s.rewardsGranted.map((r, i) => (
            <Text key={i} style={[type.bodyMedium, onSurface, styles.item]}>
              {c.itemReward(r)}
            </Text>
          ))}
        </>,
      );
    }
    if (s.pending.length > 0 || s.banked.length > 0) {
      add(
        'pending',
        <>
          <Text accessibilityRole="header" style={[type.titleSmall, onSurface]}>
            {l10n.pendingRewards}
          </Text>
          {s.pending.map((r, i) => (
            <Text key={`p${i}`} style={[type.bodyMedium, onSurface, styles.item]}>
              {c.pendingLine(r)}
            </Text>
          ))}
          {s.banked.map((r, i) => (
            <Text key={`b${i}`} style={[type.bodyMedium, onSurface, styles.item]}>
              {l10n.bankedItem(c.itemReward(r))}
            </Text>
          ))}
        </>,
      );
    }
    if (s.skippedCap > 0) add('skipped', <Text style={[type.bodyMedium, onSurface]}>{l10n.skippedCap(s.skippedCap)}</Text>);
    if ((props.showInvitePageSettings ?? true) && !paused && code != null && !d.offline && d.prefs != null) {
      add(
        'settings',
        <>
          <View style={[styles.divider, { backgroundColor: theme.outline }]} />
          <ReferralInvitePageSettings
            style={styles.gap}
            client={props.client}
            initialPreferences={d.prefs}
            sharerRewarded={c.sharerJoined != null || c.sharerPaid != null}
            onLeft={reload}
            {...(props.onEvent ? { onEvent: props.onEvent } : {})}
          />
        </>,
      );
    }
    if (props.onOpenTerms) {
      add(
        'terms',
        <View style={styles.start}>
          <Button theme={theme} variant="text" label={l10n.termsLink} onPress={props.onOpenTerms} />
        </View>,
      );
    }
    if (props.showAttribution ?? true) {
      add('attribution', <MyindAttribution variant={props.attributionVariant ?? 0} onOpen={(u) => launcher.launch(u)} />);
    }
    if (embedded) return <View style={styles.pad}>{out}</View>;
    return <ScrollView contentContainerStyle={styles.pad}>{out}</ScrollView>;
  }

  if (embedded || !(props.showAppBar ?? true)) return <View style={[styles.flexIfPage, embedded && styles.noFlex, props.style]}>{body}</View>;
  return (
    <View style={[styles.flexIfPage, { backgroundColor: theme.background }, props.style]}>
      <View style={styles.appBar}>
        <Text accessibilityRole="header" style={[type.titleLarge, { color: theme.onSurface }]}>
          {texts?.title ?? l10n.inviteTitle}
        </Text>
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flexIfPage: { flex: 1 },
  noFlex: { flex: 0 },
  appBar: { paddingHorizontal: 16, paddingVertical: 14 },
  spinner: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  spinnerEmbedded: { padding: 24, alignItems: 'center' },
  pad: { padding: 16 },
  gap: { marginTop: 16 },
  m8: { marginTop: 8 },
  center: { textAlign: 'center' },
  centerBox: { alignItems: 'center' },
  start: { alignItems: 'flex-start' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  line: { marginBottom: 8 },
  item: { paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth },
});
