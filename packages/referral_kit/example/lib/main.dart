// Demo of the referral_kit widgets over a fake RPC, so the screens can be seen without a backend. A real app passes
// `(fn, params) => Supabase.instance.client.rpc(fn, params: params)` instead (see the package README).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:referral_kit/referral_kit.dart';

Future<Object?> fakeRpc(String fn, Map<String, Object?> params) async {
  switch (fn) {
    case 'referral_my_code':
      return {'code': 'ABCDEFGH', 'reason': 'ok'};
    case 'referral_terms':
      return {
        'enabled': true,
        'paid_enabled': true,
        'rule_set_version': 1,
        'rules': [
          {'event': 'joined', 'who': 'friend', 'kind': 'minutes', 'amount': 30, 'params': {}},
          {'event': 'joined', 'who': 'sharer', 'kind': 'minutes', 'amount': 30, 'params': {}},
          {
            'event': 'paid',
            'who': 'sharer',
            'kind': 'entitlement_days',
            'amount': 5,
            'params': {'entitlement_id': 'premium'},
          },
        ],
        'claim_window_days': 7,
        'activate_window_days': 30,
        'paid_window_days': 90,
        'hold_hours': 72,
        'sharer_joins_per_30d': 10,
        'sharer_paid_per_365d': 6,
      };
    case 'referral_stats':
      return {
        'rewards_granted': [],
        'pending': [],
        'banked': [],
        'skipped_cap': 0,
        'joined_count': null,
        'paid_count': null,
      };
    case 'referral_pending':
      return [];
    case 'referral_claim':
      return {'reason': 'unknown_code'};
    default:
      return {};
  }
}

void main() => runApp(const ExampleApp());

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    final client = ReferralClient(rpc: fakeRpc, installIds: DefaultInstallIdStore());
    final queue = PendingClaimQueue(client: client, store: SharedPreferencesKeyValueStore());
    return MaterialApp(
      localizationsDelegates: const [
        referralKitLocalizationsDelegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: ReferralKitLocalizations.supportedLocales,
      home: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('referral_kit example')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ReferralRewardCard(client: client),
              InviteCodeEntry(client: client, queue: queue),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => InviteFriendsScreen(
                      client: client,
                      appName: 'Example',
                      inviteLink: (code) => Uri.parse('https://example.com/i/$code'),
                    ),
                  ),
                ),
                child: const Text('Invite friends'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
