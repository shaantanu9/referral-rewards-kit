// One rewarded ad through RevenueCat's AdMob adapter, verified by RevenueCat (ADR 0002 §18.5). Copy this file into an
// app and pass `RevenueCatRewardedAd(adUnitId: …).show` to `RewardedAdButton.onShowAd`.
//
// Written against purchases_flutter 11.0.2, purchases_admob_flutter 11.0.2, google_mobile_ads 8.0.0 (their source,
// 2026-11-14). Needs: Purchases.configure(...) and Purchases.logIn(<Supabase user id>) first, MobileAds initialised,
// the ad unit's server-side verification pointed at RevenueCat in AdMob, and the ad unit's reward set in RevenueCat.
// Google's test ad unit ids load and show but never verify (no SSV): use a real ad unit for the full check.

import 'dart:async';

import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:purchases_admob_flutter/purchases_admob_flutter.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

/// What happened to one ad.
enum AdOutcome { verified, verifiedNoReward, notVerified, failedToLoad, dismissed }

class AdResult {
  const AdResult(this.outcome, {this.rewards = const [], this.error});
  final AdOutcome outcome;
  final List<VerifiedReward> rewards;
  final String? error;

  /// Human-readable lines for a log ("10 GEMS", "premium until …").
  List<String> get lines => [
    for (final r in rewards)
      switch (r) {
        VerifiedVirtualCurrencyReward(:final code, :final amount) => '$amount $code',
        VerifiedEntitlementReward(:final identifier, :final expiresAt) => '$identifier until ${expiresAt ?? 'no end'}',
        VerifiedNoReward() => 'verified, no reward configured',
        _ => 'a reward this SDK version does not model',
      },
  ];
}

class RevenueCatRewardedAd {
  RevenueCatRewardedAd({required this.adUnitId, this.placement, this.timeout = const Duration(seconds: 30)});

  final String adUnitId;

  /// Shows in RevenueCat's ad charts.
  final String? placement;
  final Duration timeout;

  /// Loads, enables RevenueCat verification, shows, and waits for RevenueCat's verdict.
  Future<AdResult> run() async {
    final loaded = Completer<RewardedAd?>();
    String? loadError;
    await RevenueCatAdMob.loadAndTrackRewardedAd(
      adUnitId: adUnitId,
      request: const AdRequest(),
      placement: placement,
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) => loaded.complete(ad),
        onAdFailedToLoad: (error) {
          loadError = error.message;
          loaded.complete(null);
        },
      ),
    );
    final ad = await loaded.future.timeout(timeout, onTimeout: () => null);
    if (ad == null) return AdResult(AdOutcome.failedToLoad, error: loadError ?? 'timeout');

    await ad.enableRewardVerification();
    final verdict = Completer<RewardVerificationResult?>();
    ad.setTrackingFullScreenContentCallback(
      FullScreenContentCallback(
        onAdDismissedFullScreenContent: (a) {
          a.dispose();
          // Dismissed before a reward: no verification callback will come.
          Future<void>.delayed(const Duration(seconds: 2), () {
            if (!verdict.isCompleted) verdict.complete(null);
          });
        },
        onAdFailedToShowFullScreenContent: (a, error) {
          a.dispose();
          if (!verdict.isCompleted) verdict.complete(null);
        },
      ),
    );
    await ad.showWithRewardVerification(
      placement: placement,
      onRewardVerificationCompleted: (result) {
        if (!verdict.isCompleted) verdict.complete(result);
      },
    );
    final result = await verdict.future.timeout(timeout, onTimeout: () => null);
    if (result == null) return const AdResult(AdOutcome.dismissed);
    if (result.failed || result.reward == null) return const AdResult(AdOutcome.notVerified);
    final rewards = [result.reward!, ...result.moreRewards];
    final none = rewards.every((r) => r is VerifiedNoReward);
    return AdResult(none ? AdOutcome.verifiedNoReward : AdOutcome.verified, rewards: rewards);
  }

  /// For `RewardedAdButton.onShowAd`: true when RevenueCat verified the ad (the engine then hears it by webhook).
  Future<bool> show() async {
    final r = await run();
    return r.outcome == AdOutcome.verified || r.outcome == AdOutcome.verifiedNoReward;
  }
}
