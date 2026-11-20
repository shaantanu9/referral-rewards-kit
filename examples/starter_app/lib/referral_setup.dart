// The referral wiring an app needs, in one place. Copy this file and change the marked lines.
import 'package:flutter/foundation.dart';
import 'package:referral_kit/referral_kit.dart';

import 'fake_referral_server.dart';
import 'invite_link.dart';

/// Build-time settings (`--dart-define=...`). With no Supabase URL the app runs on [FakeReferralServer].
const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

/// The invite page (web/invite hosted at `https://<site>/i/<CODE>`). Empty until the page is live: Share then sends
/// the code and [storeLink] instead.
const inviteBase = String.fromEnvironment('INVITE_BASE_URL');

/// Your app's store page (CHANGE): shared with the code while there is no invite page.
final storeLink = Uri.parse('https://apps.apple.com/app/id0000000000');

/// Reward names in your app's words (CHANGE): the kit knows amounts, the app knows what they buy.
String chaptersLabel(num n) => '${n.round()} free chapter${n.round() == 1 ? '' : 's'}';
const rewardLabels = RewardLabels(
  byKind: {'chapters': chaptersLabel},
  entitlementNames: {'plus': 'Plus'},
  defaultEntitlementName: 'Plus',
);

/// Everything referral, built once at start-up.
class ReferralSetup {
  ReferralSetup({
    FakeReferralServer? fake,
    KeyValueStore? store,
    InstallIdStore? installIds,
    InstallReferrerSource? referrerSource,
  }) : fake = supabaseUrl.isEmpty ? (fake ?? FakeReferralServer()) : null,
       store = store ?? SharedPreferencesKeyValueStore() {
    client = ReferralClient(
      rpc: this.fake?.call ?? _httpRpc().call,
      installIds: installIds ?? DefaultInstallIdStore(),
      // One analytics source: forward every funnel event to your analytics (Firebase, PostHog, your own table).
      onEvent: _forward,
      codeHashSalt: 'starter-app', // CHANGE: an app-specific salt
      eventStore: this.store, // reward_granted once per reward, referral_feature_hidden once a day
    );
    queue = PendingClaimQueue(client: client, store: this.store);
    // Sends a code the friend tapped while offline: on app resume, and on sign-in. CHANGE: your auth stream
    // (Supabase: `supabase.auth.onAuthStateChange`) and, if you have one, a reconnect stream.
    retrier = PendingClaimRetrier(queue: queue, signInChanges: signInChanges);
    referrer = InstallReferrerCodeReader(store: this.store, source: referrerSource);
  }

  /// Fires when the user signs in or out. CHANGE: `supabase.auth.onAuthStateChange` (or your auth's stream).
  Stream<Object?> get signInChanges => fake?.signInChanges ?? const Stream.empty();

  final FakeReferralServer? fake;
  final KeyValueStore store;

  /// Also told about every event (the starter's on-screen Events list).
  void Function(ReferralEvent event)? onAnalytics;
  late final ReferralClient client;
  late final PendingClaimQueue queue;
  late final PendingClaimRetrier retrier;
  late final InstallReferrerCodeReader referrer;

  /// Once at start-up: a code from the Play install referrer (Android; null elsewhere and on later starts) is kept
  /// like a link code. Nothing is claimed: after sign-in the friend sees "Use code …" and taps once.
  /// Returns true when it kept a code now.
  Future<bool> start() async {
    final code = await referrer.readOnce();
    return code != null && await queue.keep(code, source: 'install_referrer');
  }

  /// An invite link arrived (`/i/<CODE>`): keep its code until the friend is signed in and taps "Use code …".
  /// Returns the code, or null when the link has none. The first code a friend arrived with wins.
  Future<String?> openedInviteLink(String link) async {
    final code = codeFromInviteLink(link);
    if (code != null) await queue.keep(code);
    return code;
  }

  /// The invite link for a code, or null while there is no invite page.
  Uri? inviteLink(String code) => inviteBase.isEmpty ? null : Uri.parse('$inviteBase/$code');

  void _forward(ReferralEvent e) {
    debugPrint(
      '[analytics] ${e.wireName} ${e.props}',
    ); // CHANGE: analytics.logEvent(name: e.wireName, parameters: e.props)
    onAnalytics?.call(e);
  }

  static ReferralHttpRpc _httpRpc() => ReferralHttpRpc(
    supabaseUrl: supabaseUrl,
    anonKey: supabaseAnonKey,
    accessToken: () async =>
        null, // CHANGE: your signed-in user's access token (supabase.auth.currentSession?.accessToken)
  );

  void dispose() {
    retrier.dispose();
    fake?.dispose();
  }
}
