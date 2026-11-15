import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

import 'code_format.dart';
import 'l10n/gen/referral_kit_localizations.dart';
import 'models.dart';

/// App-supplied names for reward kinds (ADR 11.1): the kit knows amounts, the app knows what they buy.
class RewardLabels {
  const RewardLabels({
    this.byKind = const {},
    this.entitlementNames = const {},
    this.defaultEntitlementName = 'Premium',
  });

  /// Full label per kind, e.g. `{'minutes': (n) => '$n min of natural voice'}`. Wins over the defaults.
  final Map<String, String Function(num amount)> byKind;

  /// Display name per RevenueCat entitlement id for `entitlement_days`, e.g. `{'premium': 'Premium'}`.
  final Map<String, String> entitlementNames;

  /// Name used when a rule does not name its entitlement (the server then uses `settings.entitlement_id`, which
  /// `referral_terms()` does not return).
  final String defaultEntitlementName;
}

/// Builds [RewardLabels] with a [BuildContext], so reward names can come from the app's own localisations:
/// `labelsBuilder: (context) => RewardLabels(byKind: {'minutes': (n) => AppL10n.of(context).voiceMinutes(n)})`.
/// Every widget that takes `labels` also takes `labelsBuilder`; when set, it wins.
typedef RewardLabelsBuilder = RewardLabels Function(BuildContext context);

/// The labels a widget should use: [builder] with [context] when given, else [labels].
RewardLabels resolveRewardLabels(BuildContext context, RewardLabels labels, RewardLabelsBuilder? builder) =>
    builder == null ? labels : builder(context);

/// Every user-facing sentence, built from the active rules in [terms] (ADR 11.1, 11.2). Nothing about amounts,
/// caps or windows is hard-coded: a rule the owner turns off disappears from every sentence.
class ReferralCopy {
  ReferralCopy({required this.l10n, required this.terms, this.labels = const RewardLabels()});

  final ReferralKitLocalizations l10n;
  final ReferralTerms terms;
  final RewardLabels labels;

  ReferralRule? get sharerJoined => terms.rule('joined', 'sharer');
  ReferralRule? get friendJoined => terms.rule('joined', 'friend');
  ReferralRule? get sharerPaid => terms.rule('paid', 'sharer');

  /// Label for a reward kind and amount, e.g. "30 min" or "5 days of Premium".
  String reward(String kind, num amount, [Map<String, Object?> params = const {}]) {
    final custom = labels.byKind[kind];
    if (custom != null) return custom(amount);
    final n = amount.round();
    switch (kind) {
      case 'minutes':
        return l10n.rewardMinutes(n);
      case 'entitlement_days':
        final id = params['entitlement_id']?.toString() ?? '';
        return l10n.rewardEntitlementDays(
          n,
          labels.entitlementNames[id] ?? (id.isEmpty ? labels.defaultEntitlementName : id),
        );
      default:
        final a = amount == n ? '$n' : amount.toString();
        return l10n.rewardOther(a, kind.replaceAll('_', ' '));
    }
  }

  String ruleReward(ReferralRule r) => reward(r.kind, r.amount, r.params);
  String itemReward(RewardItem r) => reward(r.kind, r.amount, r.params);

  bool get _sameJoinedReward {
    final s = sharerJoined, f = friendJoined;
    return s != null && f != null && ruleReward(s) == ruleReward(f);
  }

  /// The rules as shown on the invite screen: one sentence per event that has a rule, then the caps.
  List<String> rules() {
    final out = <String>[];
    final s = sharerJoined, f = friendJoined, p = sharerPaid;
    if (s != null && f != null) {
      out.add(
        _sameJoinedReward ? l10n.rulesJoinedEach(ruleReward(s)) : l10n.rulesJoinedBoth(ruleReward(s), ruleReward(f)),
      );
    } else if (s != null) {
      out.add(l10n.rulesJoinedSharerOnly(ruleReward(s)));
    } else if (f != null) {
      out.add(l10n.rulesJoinedFriendOnly(ruleReward(f)));
    }
    if (p != null) out.add(l10n.rulesPaid(ruleReward(p)));
    return out;
  }

  /// Cap sentences for the rules that exist.
  List<String> caps() => [
    if (sharerJoined != null && terms.sharerJoinsPer30d > 0) l10n.capJoins(terms.sharerJoinsPer30d),
    if (sharerPaid != null && terms.sharerPaidPer365d > 0) l10n.capPaid(terms.sharerPaidPer365d),
  ];

  /// Secondary paywall line, with its condition; null when there is no paid rule.
  String? paywallLine() {
    final p = sharerPaid;
    return p == null ? null : l10n.paywallLine(ruleReward(p));
  }

  /// Shown to the friend before they confirm a code (ADR 4.2 step 4): names only events that reward the sharer.
  /// Null when the sharer learns nothing.
  String? friendDisclosure() {
    final joined = sharerJoined != null, paid = sharerPaid != null;
    if (joined && paid) return l10n.friendDisclosureBoth;
    if (joined) return l10n.friendDisclosureJoined;
    if (paid) return l10n.friendDisclosurePaid;
    return null;
  }

  /// Share sheet text in the sharer's language; the code is wrapped in a left-to-right isolate.
  String shareText({required String appName, required String code, required String link}) {
    final c = isolatedCode(code);
    final s = sharerJoined, f = friendJoined;
    if (s != null && f != null && _sameJoinedReward) return l10n.shareTextBoth(appName, c, ruleReward(f), link);
    if (f != null) return l10n.shareTextFriendOnly(appName, c, ruleReward(f), link);
    if (s != null || sharerPaid != null) return l10n.shareTextSharerOnly(appName, c, link);
    return l10n.shareTextPlain(appName, c, link);
  }

  /// Share text when the app has no invite page: the code to type in and the app's [storeLink] (or the code alone).
  /// Names a reward only when the terms give the friend one.
  String shareTextNoLink({required String appName, required String code, String? storeLink}) {
    final c = isolatedCode(code);
    if (storeLink == null || storeLink.isEmpty) return l10n.shareTextCodeOnly(appName, c);
    final f = friendJoined;
    if (f != null && sharerJoined != null && _sameJoinedReward) {
      return l10n.shareTextNoLinkBoth(appName, c, ruleReward(f), storeLink);
    }
    if (f != null) return l10n.shareTextNoLinkFriend(appName, c, ruleReward(f), storeLink);
    return l10n.shareTextNoLinkPlain(appName, c, storeLink);
  }

  /// The friend's reward ("4 free chapters"), or null when the terms give the friend nothing.
  String? get friendReward => friendJoined == null ? null : ruleReward(friendJoined!);

  /// True when both sides get the same joined reward.
  bool get bothGetSame => friendJoined != null && sharerJoined != null && _sameJoinedReward;

  /// "A gift is waiting for you: 4 free chapters" (loss framing only when the friend rule really gives something).
  String giftTitle() {
    final r = friendReward;
    return r == null ? l10n.giftWaitingPlain : l10n.giftWaiting(r);
  }

  /// The real deadline from the server's `claim_days_left` ("Only 3 days left to add a code"), or null when there
  /// is none to show. Never a timer of its own.
  String? deadline() {
    final d = terms.claimDaysLeft;
    if (d == null || d <= 0) return null;
    return l10n.daysLeftToAdd(d);
  }

  /// The three steps to the friend's reward. [activationStep] is the app's own words for "start using the app"
  /// (e.g. "Hear your first page read aloud"); the package says "Start using {app}" otherwise.
  List<String> steps({required String appName, String? activationStep}) {
    final r = friendReward;
    return [
      l10n.stepAddCode,
      activationStep ?? l10n.stepStartUsing(appName),
      r == null ? l10n.stepGift : (bothGetSame ? l10n.stepRewardBoth(r) : l10n.stepRewardYou(r)),
    ];
  }

  /// After a code is accepted: what the second step unlocks.
  String almostLine() {
    final r = friendReward;
    if (r == null) return l10n.almostLinePlain;
    return sharerJoined != null ? l10n.almostLineBoth(r) : l10n.almostLine(r);
  }

  /// Why a code can't be added, or null when it can (or the server does not say). Closed window: "Codes are for
  /// your first 7 days, and yours have passed."; not eligible (already referred, not verified, older account).
  String? cannotAddReason() {
    if (!terms.hasClaimDaysLeft) return null;
    final d = terms.claimDaysLeft;
    if (d != null && d <= 0) return l10n.cannotAddClosed(terms.claimWindowDays);
    if (d == null) return l10n.cannotAddNotEligible(terms.claimWindowDays);
    return null;
  }

  /// Empty state of the invite screen.
  String emptyState() {
    final s = sharerJoined, f = friendJoined;
    if (s != null && f != null && _sameJoinedReward) return l10n.emptyEach(ruleReward(s));
    if (s != null) return l10n.emptySharerOnly(ruleReward(s));
    return l10n.emptyPlain;
  }

  /// Card text for a reward from `referral_pending`.
  String rewardCard(RewardItem r) {
    final label = itemReward(r);
    if (r.state == 'banked') return l10n.bankedItem(label);
    if (r.who == 'friend') return l10n.friendWelcome(label);
    if (r.event == 'paid') return l10n.sharerPaidReward(label);
    return l10n.sharerJoinedReward(label);
  }

  /// A pending reward with its approximate date.
  String pendingLine(RewardItem r) {
    final at = r.availableAt;
    if (at == null) return itemReward(r);
    return l10n.pendingItem(itemReward(r), formatDate(at, l10n.localeName));
  }

  /// Message for a claim answer (ADR 11.2). Null for `ok`.
  String? claimMessage(ClaimResult result) => claimReasonMessage(l10n, result, claimWindowDays: terms.claimWindowDays);
}

/// A short localised date. Falls back to English when the app has not loaded date data for the locale (the
/// Flutter localisation delegates load it).
String formatDate(DateTime at, String locale) {
  final local = at.toLocal();
  try {
    return DateFormat.yMMMd(locale).format(local);
  } catch (_) {
    try {
      return DateFormat.yMMMd('en_US').format(local);
    } catch (_) {
      final m = local.month.toString().padLeft(2, '0'), d = local.day.toString().padLeft(2, '0');
      return '${local.year}-$m-$d';
    }
  }
}

/// Message for a claim answer, usable without terms (ADR 11.2). `{minutes}` is `retry_after_seconds` rounded up;
/// `{claim_window_days}` comes from `referral_terms()`.
String? claimReasonMessage(ReferralKitLocalizations l10n, ClaimResult result, {required int claimWindowDays}) {
  switch (result.reason) {
    case ClaimReason.ok:
      return null;
    case ClaimReason.ownCode:
      return l10n.errOwnCode;
    case ClaimReason.alreadyReferred:
      return l10n.errAlreadyReferred;
    case ClaimReason.unknownCode:
      return l10n.errUnknownCode;
    case ClaimReason.windowClosed:
      return l10n.errWindowClosed(claimWindowDays);
    case ClaimReason.rateLimited:
      return l10n.errRateLimited(retryMinutes(result.retryAfterSeconds));
    case ClaimReason.notVerified:
      return l10n.errNotVerified;
    case ClaimReason.sameInstall:
      return l10n.errSameInstall;
    case ClaimReason.programPaused:
      return l10n.errProgramPaused;
    case ClaimReason.underAge:
    case ClaimReason.anonymousUser:
      return l10n.errUnavailable;
    case ClaimReason.unknown:
      return l10n.errGeneric;
  }
}

/// Seconds → whole minutes, rounded up, at least 1.
int retryMinutes(int? seconds) {
  final s = seconds ?? 60;
  final m = (s + 59) ~/ 60;
  return m < 1 ? 1 : m;
}
