import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ReferralEvent,
  ReferralEventName,
  reportReferralEvent,
  type ClaimResult,
  type InviteLinkBuilder,
  type KeyValueStore,
  type PendingClaimQueue,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralLauncher,
  type ReferralTexts,
  type RewardLabels,
  type ShareHandler,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import type { QrRenderer, ReferralClipboard } from '../platform';
import { type } from '../ui/primitives';
import { InviteCodeSection } from './InviteCodeSection';
import { InviteFriendsScreen } from './InviteFriendsScreen';
import { MyindAttribution } from './MyindAttribution';
import type { ReferralUnavailableRender } from './ReferralMessage';

/** The two parts of an `InviteHub`. */
export const InviteHubSection = {
  /** "Your invite code" with Share and Copy, the rules, caps, joined count and what you earned. */
  invite: 'invite',
  /** The friend's code: the gift, the real days left, the field, the steps, "almost yours" after a code. */
  enterCode: 'enterCode',
} as const;
export type InviteHubSection = (typeof InviteHubSection)[keyof typeof InviteHubSection];

/** `ref.current.scrollTo(section)` brings a part into view (a no-op when hidden or not scrollable). */
export interface InviteHubHandle {
  scrollTo(section: InviteHubSection, opts?: { animated?: boolean }): void;
}

export interface InviteHubProps {
  client: ReferralClient;
  queue: PendingClaimQueue;
  appName: string;
  inviteLink?: InviteLinkBuilder;
  storeLink?: string;
  labels?: RewardLabels;
  /** The app's own words for both parts. */
  texts?: ReferralTexts;
  onOpenTerms?: () => void;
  share?: ShareHandler;
  codeCache?: KeyValueStore;
  /** App art above the code. */
  header?: ReactNode;
  shareText?: (code: string, link: string) => string;
  onCopied?: (code: string) => void;
  /** Default true. */
  showInvite?: boolean;
  /** Default true. */
  showEntry?: boolean;
  /** Scrolls to this part once it has loaded. */
  initialSection?: InviteHubSection;
  /** Where the app opened the hub from (`invite_screen_viewed.from`): `you`, `settings`, `home`, `deeplink`… */
  from?: string;
  eligibleFrom?: Date | null;
  /** A code from a link or the install referrer, shown with one-tap confirm. */
  initialCode?: string | null;
  onClaimed?: (result: ClaimResult) => void;
  onAlmostAction?: () => void;
  /** App art above / beside the friend part's headline. */
  entryHeader?: ReactNode;
  entryLeading?: ReactNode;
  showSteps?: boolean;
  /** Replaces "Have an invite code?" (wins over `texts.entryTitle`). */
  entryTitle?: string;
  onEvent?: ReferralEventSink;
  renderUnavailable?: ReferralUnavailableRender;
  onSignIn?: () => void;
  /** A title bar with [title] ("Invite friends"). False when the app's navigator shows its own. Default true. */
  showAppBar?: boolean;
  title?: string;
  /** False: no scroll view of its own, for an app that embeds the hub in its own scrolling page. Default true. */
  scrollable?: boolean;
  pastePlatform?: string;
  clock?: () => Date;
  launcher?: ReferralLauncher;
  showWhatsApp?: boolean;
  showQrCode?: boolean;
  showInvitePageSettings?: boolean;
  /** The small "Built with Myind" link at the bottom, shown once for both parts. Free to turn off. Default true. */
  showAttribution?: boolean;
  /** Which link text. Default 0. */
  attributionVariant?: number;
  clipboard?: ReferralClipboard;
  renderQr?: QrRenderer;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * The one invite screen an app needs: your code with Share / Copy on top, and a friend's code below. Built from
 * `InviteFriendsScreen` (embedded) and `InviteCodeSection`, so every slot they have works here. Reports
 * `invite_screen_viewed` once per open with [from] and the focus. With both parts shown, "not available" is
 * explained once (by the invite part).
 */
export const InviteHub = forwardRef<InviteHubHandle, InviteHubProps>(function InviteHub(props, ref) {
  const kit = useReferralKit();
  // Typed by what is used, so the ref works with the ScrollView types of every supported React Native version.
  const scroll = useRef<{ scrollTo(o: { y: number; animated?: boolean }): void } | null>(null);
  const offsets = useRef<Partial<Record<InviteHubSection, number>>>({});
  const pending = useRef<InviteHubSection | null>(props.initialSection ?? null);
  const showInvite = props.showInvite ?? true;
  const showEntry = props.showEntry ?? true;
  const both = showInvite && showEntry;
  const scrollable = props.scrollable ?? true;
  const launcher = props.launcher ?? kit.launcher;

  const scrollTo = (section: InviteHubSection, opts: { animated?: boolean } = {}): void => {
    const y = offsets.current[section];
    if (y == null || !scroll.current) return;
    scroll.current.scrollTo({ y: Math.max(0, y - 8), animated: opts.animated ?? true });
  };
  useImperativeHandle(ref, () => ({ scrollTo }));

  const scrollSoon = (): void => {
    const target = pending.current;
    if (target == null) return;
    setTimeout(() => {
      pending.current = null;
      scrollTo(target, { animated: false });
    }, 0);
  };

  useEffect(() => {
    reportReferralEvent(
      props.onEvent ?? props.client.onEvent,
      new ReferralEvent(ReferralEventName.inviteScreenViewed, {
        from: props.from ?? 'unknown',
        focus: props.initialSection === InviteHubSection.enterCode ? 'code' : 'share',
      }),
    );
    // With the invite part shown, wait for its data (onLoaded): it changes the height above the entry.
    if (!showInvite) scrollSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseTexts = props.texts ?? kit.texts;
  const texts: ReferralTexts | undefined = props.entryTitle == null ? baseTexts : { ...(baseTexts ?? {}), entryTitle: props.entryTitle };
  const opt = <K extends keyof InviteHubProps>(k: K): Partial<Pick<InviteHubProps, K>> =>
    props[k] === undefined ? {} : ({ [k]: props[k] } as Partial<Pick<InviteHubProps, K>>);

  const column = (
    <View>
      {showInvite ? (
        <View onLayout={(e) => (offsets.current.invite = e.nativeEvent.layout.y)}>
          <InviteFriendsScreen
            client={props.client}
            appName={props.appName}
            {...opt('inviteLink')}
            {...opt('storeLink')}
            {...opt('labels')}
            {...opt('onOpenTerms')}
            {...opt('share')}
            {...opt('codeCache')}
            {...opt('header')}
            {...opt('shareText')}
            {...opt('onCopied')}
            {...opt('onEvent')}
            {...opt('renderUnavailable')}
            {...opt('onSignIn')}
            {...opt('showWhatsApp')}
            {...opt('showQrCode')}
            {...opt('showInvitePageSettings')}
            {...opt('clock')}
            {...opt('clipboard')}
            {...opt('renderQr')}
            {...(texts ? { texts } : {})}
            launcher={launcher}
            embedded
            onLoaded={scrollSoon}
            showAttribution={false}
          />
        </View>
      ) : null}
      {both ? <View style={[styles.divider, { backgroundColor: kit.theme.outline }]} /> : null}
      {showEntry ? (
        <View style={styles.entry} onLayout={(e) => (offsets.current.enterCode = e.nativeEvent.layout.y)}>
          <InviteCodeSection
            client={props.client}
            queue={props.queue}
            appName={props.appName}
            {...opt('labels')}
            {...(texts ? { texts } : {})}
            {...opt('initialCode')}
            {...opt('eligibleFrom')}
            {...opt('onClaimed')}
            {...opt('onAlmostAction')}
            {...(props.entryHeader !== undefined ? { header: props.entryHeader } : {})}
            {...(props.entryLeading !== undefined ? { leading: props.entryLeading } : {})}
            {...opt('showSteps')}
            {...opt('onEvent')}
            {...opt('onSignIn')}
            {...opt('pastePlatform')}
            {...opt('clock')}
            // With both parts shown, the invite part explains "not available" once; the entry hides itself.
            {...(both ? { renderUnavailable: () => null } : opt('renderUnavailable'))}
          />
        </View>
      ) : null}
      {(props.showAttribution ?? true) ? (
        <View style={styles.attribution}>
          <MyindAttribution variant={props.attributionVariant ?? 0} onOpen={(u) => launcher.launch(u)} />
        </View>
      ) : null}
    </View>
  );

  if (!scrollable) return <View style={[styles.bottom, props.style]}>{column}</View>;
  const body = (
    <ScrollView ref={scroll as never} testID="referral-hub-scroll" style={styles.flex} contentContainerStyle={[styles.bottom, props.contentContainerStyle]}>
      {column}
    </ScrollView>
  );
  if (!(props.showAppBar ?? true)) return <View style={[styles.flex, props.style]}>{body}</View>;
  return (
    <View style={[styles.flex, { backgroundColor: kit.theme.background }, props.style]}>
      <View style={styles.appBar}>
        <Text accessibilityRole="header" style={[type.titleLarge, { color: kit.theme.onSurface }]}>
          {props.title ?? texts?.title ?? kit.l10n.inviteTitle}
        </Text>
      </View>
      {body}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bottom: { paddingBottom: 24 },
  appBar: { paddingHorizontal: 16, paddingVertical: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  entry: { padding: 16 },
  attribution: { paddingHorizontal: 16 },
});
