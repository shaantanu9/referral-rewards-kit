// Live check: rewarded ads through RevenueCat → rewards engine (ADR 0002 §18.5). One screen: what is configured,
// sign in, RevenueCat linked to the Supabase user, watch a verified ad, and the engine's state refreshing after it.
//
// Run (only public keys; never a service-role or secret key):
//   flutter run \
//     --dart-define=SUPABASE_URL=https://<ref>.supabase.co --dart-define=SUPABASE_ANON_KEY=<anon key> \
//     --dart-define=RC_API_KEY=<RevenueCat public SDK key for this platform> \
//     --dart-define=AD_UNIT_ID=<real rewarded ad unit id with SSV to RevenueCat>
// The AdMob app id goes in ios/Runner/Info.plist (GADApplicationIdentifier) and
// android/app/src/main/AndroidManifest.xml (com.google.android.gms.ads.APPLICATION_ID); see README.md.
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:purchases_flutter/purchases_flutter.dart';
import 'package:rewards_kit/rewards_kit.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'check_config.dart';
import 'revenuecat_rewarded_ad.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const cfg = CheckConfig.fromEnvironment();
  final boot = <String>[];
  if (cfg.hasSupabase) {
    await Supabase.initialize(url: cfg.supabaseUrl, publishableKey: cfg.supabaseAnonKey);
  } else {
    boot.add('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }
  if (cfg.hasRevenueCat) {
    await Purchases.configure(PurchasesConfiguration(cfg.rcApiKey));
  } else {
    boot.add('RC_API_KEY missing');
  }
  await MobileAds.instance.initialize();
  runApp(CheckApp(cfg: cfg, bootProblems: boot));
}

class CheckApp extends StatelessWidget {
  const CheckApp({super.key, required this.cfg, required this.bootProblems});
  final CheckConfig cfg;
  final List<String> bootProblems;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Rewards ads check',
    theme: ThemeData(colorSchemeSeed: Colors.teal),
    home: CheckScreen(cfg: cfg, bootProblems: bootProblems),
  );
}

class CheckScreen extends StatefulWidget {
  const CheckScreen({super.key, required this.cfg, required this.bootProblems});
  final CheckConfig cfg;
  final List<String> bootProblems;

  @override
  State<CheckScreen> createState() => _CheckScreenState();
}

class _CheckScreenState extends State<CheckScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _log = <String>[];
  String? _rcUser;
  bool _codeSent = false;
  RewardsController? _rewards;

  SupabaseClient? get _sb => widget.cfg.hasSupabase ? Supabase.instance.client : null;
  String? get _uid => _sb?.auth.currentUser?.id;

  @override
  void initState() {
    super.initState();
    if (_uid != null) _afterSignIn();
  }

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _rewards?.dispose();
    super.dispose();
  }

  void _say(String line) => setState(() => _log.insert(0, '${TimeOfDay.now().format(context)}  $line'));

  Future<void> _sendCode() async {
    try {
      await _sb!.auth.signInWithOtp(email: _email.text.trim(), shouldCreateUser: true);
      setState(() => _codeSent = true);
      _say('Code sent to ${_email.text.trim()}');
    } on Object catch (e) {
      _say('Sign-in code failed: $e');
    }
  }

  Future<void> _verify() async {
    try {
      await _sb!.auth.verifyOTP(type: OtpType.email, email: _email.text.trim(), token: _code.text.trim());
      await _afterSignIn();
    } on Object catch (e) {
      _say('Code not accepted: $e');
    }
  }

  // RevenueCat must know the user by the Supabase id, or the engine cannot tell whose ad it was.
  Future<void> _afterSignIn() async {
    final uid = _uid;
    if (uid == null) return;
    if (widget.cfg.hasRevenueCat) {
      try {
        await Purchases.logIn(uid);
        _rcUser = await Purchases.appUserID;
      } on Object catch (e) {
        _say('RevenueCat logIn failed: $e');
      }
    }
    _rewards?.dispose();
    _rewards = RewardsController(
      client: RewardsClient(
        rpc: (fn, params) => _sb!.rpc(fn, params: params),
        onEvent: (e) => _say(e.toString()),
      ),
    );
    await _rewards!.refresh();
    if (mounted) setState(() {});
  }

  Future<bool> _showAd() async {
    if (!widget.cfg.hasAdUnit) {
      _say('AD_UNIT_ID missing');
      return false;
    }
    _say('Loading ad…');
    final r = await RevenueCatRewardedAd(adUnitId: widget.cfg.adUnitId, placement: 'rewards_check').run();
    _say('Ad: ${r.outcome.name}${r.error == null ? '' : ' (${r.error})'} ${r.lines.join(', ')}');
    return r.outcome == AdOutcome.verified || r.outcome == AdOutcome.verifiedNoReward;
  }

  @override
  Widget build(BuildContext context) {
    final checks = widget.cfg.checks(signedIn: _uid != null, rcUser: _rcUser, uid: _uid);
    final rewards = _rewards;
    return Scaffold(
      appBar: AppBar(title: const Text('Rewards ads check')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final p in widget.bootProblems)
            ListTile(
              leading: const Icon(Icons.error, color: Colors.red),
              title: Text(p),
            ),
          for (final c in checks)
            ListTile(
              dense: true,
              leading: Icon(
                c.ok ? Icons.check_circle : Icons.radio_button_unchecked,
                color: c.ok ? Colors.green : null,
              ),
              title: Text(c.label),
              subtitle: c.hint == null ? null : Text(c.hint!),
            ),
          if (_sb != null && _uid == null) ...[
            TextField(
              controller: _email,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            if (_codeSent)
              TextField(
                controller: _code,
                decoration: const InputDecoration(labelText: 'Code from the email'),
              ),
            const SizedBox(height: 8),
            FilledButton(onPressed: _codeSent ? _verify : _sendCode, child: Text(_codeSent ? 'Sign in' : 'Send code')),
          ],
          if (rewards != null) ...[
            const SizedBox(height: 12),
            RewardedAdButton(controller: rewards, label: 'Watch a verified ad', onShowAd: _showAd),
            const SizedBox(height: 12),
            RewardsHub(controller: rewards, scrollable: false, padding: EdgeInsets.zero),
          ],
          const Divider(height: 32),
          Text('Log', style: Theme.of(context).textTheme.titleMedium),
          for (final l in _log) Text(l, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
        ],
      ),
    );
  }
}
