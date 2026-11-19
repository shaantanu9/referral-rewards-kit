// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'referral_kit_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Hindi (`hi`).
class ReferralKitLocalizationsHi extends ReferralKitLocalizations {
  ReferralKitLocalizationsHi([String locale = 'hi']) : super(locale);

  @override
  String get inviteTitle => 'दोस्तों को बुलाएँ';

  @override
  String get yourCode => 'आपका इनवाइट कोड';

  @override
  String get share => 'शेयर करें';

  @override
  String get copyCode => 'कोड कॉपी करें';

  @override
  String get codeCopied => 'कोड कॉपी हो गया';

  @override
  String get termsLink => 'प्रोग्राम की शर्तें';

  @override
  String get rewardsEarned => 'मिले इनाम';

  @override
  String get pendingRewards => 'आने वाले इनाम';

  @override
  String pendingItem(String reward, String date) {
    return '$reward, लगभग $date तक';
  }

  @override
  String bankedItem(String reward) {
    return '$reward, आपका मौजूदा प्लान खत्म होने पर जुड़ेंगे।';
  }

  @override
  String skippedCap(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count इनाम सीमा से ऊपर थे',
      one: '1 इनाम सीमा से ऊपर था',
    );
    return '$_temp0';
  }

  @override
  String joinedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count दोस्त जुड़े', one: '1 दोस्त जुड़ा');
    return '$_temp0';
  }

  @override
  String claimedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count दोस्तों ने आपका कोड इस्तेमाल किया। जब वे ऐप इस्तेमाल करना शुरू करेंगे, आपको इनाम मिलेंगे।',
      one: '1 दोस्त ने आपका कोड इस्तेमाल किया। जब वे ऐप इस्तेमाल करना शुरू करेंगे, आपको इनाम मिलेगा।',
    );
    return '$_temp0';
  }

  @override
  String rulesJoinedEach(String reward) {
    return 'जब आपका दोस्त साइन अप करके ऐप इस्तेमाल करना शुरू करेगा, तो आप दोनों को $reward मिलेंगे।';
  }

  @override
  String rulesJoinedBoth(String sharerReward, String friendReward) {
    return 'जब आपका दोस्त साइन अप करके ऐप इस्तेमाल करना शुरू करेगा, तो आपको $sharerReward और आपके दोस्त को $friendReward मिलेंगे।';
  }

  @override
  String rulesJoinedSharerOnly(String reward) {
    return 'जब आपका बुलाया दोस्त साइन अप करके ऐप इस्तेमाल करना शुरू करेगा, तो आपको $reward मिलेंगे।';
  }

  @override
  String rulesJoinedFriendOnly(String reward) {
    return 'जब आपका दोस्त साइन अप करके ऐप इस्तेमाल करना शुरू करेगा, तो उसे $reward मिलेंगे।';
  }

  @override
  String rulesPaid(String reward) {
    return 'जब आपका बुलाया दोस्त सब्सक्राइब करेगा (किसी भी फ्री ट्रायल के बाद), तो आपको $reward मिलेंगे।';
  }

  @override
  String capJoins(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'हर महीने $count दोस्तों तक गिने जाते हैं।',
      one: 'हर महीने 1 दोस्त तक गिना जाता है।',
    );
    return '$_temp0';
  }

  @override
  String capPaid(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'हर साल सब्सक्राइब करने वाले $count दोस्तों तक गिने जाते हैं।',
      one: 'हर साल सब्सक्राइब करने वाला 1 दोस्त तक गिना जाता है।',
    );
    return '$_temp0';
  }

  @override
  String paywallLine(String reward) {
    return 'या जब आपका बुलाया दोस्त सब्सक्राइब करे, तो $reward मुफ़्त पाएँ।';
  }

  @override
  String get friendDisclosureBoth =>
      'जब आप ऐप इस्तेमाल करना शुरू करेंगे, तो आपको बुलाने वाले को इनाम मिलेगा, और आपके सब्सक्राइब करने पर एक और, इसलिए उन्हें पता चलेगा कि ऐसा हुआ। वे आपका ईमेल या आपकी खरीदारी कभी नहीं देखते।';

  @override
  String get friendDisclosureJoined =>
      'जब आप ऐप इस्तेमाल करना शुरू करेंगे, तो आपको बुलाने वाले को इनाम मिलेगा, इसलिए उन्हें पता चलेगा कि ऐसा हुआ। वे आपका ईमेल या आपकी खरीदारी कभी नहीं देखते।';

  @override
  String get friendDisclosurePaid =>
      'आपके सब्सक्राइब करने पर आपको बुलाने वाले को इनाम मिलेगा, इसलिए उन्हें पता चलेगा कि ऐसा हुआ। वे आपका ईमेल या आपकी खरीदारी कभी नहीं देखते।';

  @override
  String friendWelcome(String reward) {
    return 'वेलकम बोनस: $reward, आपके इनवाइट की बदौलत।';
  }

  @override
  String sharerJoinedReward(String reward) {
    return 'आपके बुलाए एक दोस्त ने ऐप इस्तेमाल करना शुरू किया। आपको $reward मिले।';
  }

  @override
  String sharerPaidReward(String reward) {
    return 'आपके बुलाए एक दोस्त ने सब्सक्राइब किया। आपको $reward मिले।';
  }

  @override
  String shareTextBoth(String app, String code, String reward, String link) {
    return 'मैं $app इस्तेमाल कर रहा/रही हूँ। मेरे कोड $code से जुड़ें और हम दोनों को $reward मिलेंगे: $link';
  }

  @override
  String shareTextSharerOnly(String app, String code, String link) {
    return 'मैं $app इस्तेमाल कर रहा/रही हूँ। मेरे कोड $code से जुड़ें और मुझे बोनस मिलेगा: $link';
  }

  @override
  String shareTextFriendOnly(String app, String code, String reward, String link) {
    return 'मैं $app इस्तेमाल कर रहा/रही हूँ। मेरे कोड $code से जुड़ें और आपको $reward मिलेंगे: $link';
  }

  @override
  String shareTextPlain(String app, String code, String link) {
    return 'मैं $app इस्तेमाल कर रहा/रही हूँ। मेरे कोड $code से जुड़ें: $link';
  }

  @override
  String emptyEach(String reward) {
    return 'अभी तक कोई इनवाइट नहीं। अपना कोड शेयर करें: दोस्त के ऐप इस्तेमाल शुरू करने पर आप दोनों को $reward मिलेंगे।';
  }

  @override
  String emptySharerOnly(String reward) {
    return 'अभी तक कोई इनवाइट नहीं। अपना कोड शेयर करें: दोस्त के ऐप इस्तेमाल शुरू करने पर आपको $reward मिलेंगे।';
  }

  @override
  String get emptyPlain => 'अभी तक कोई इनवाइट नहीं। अपना कोड किसी दोस्त से शेयर करें।';

  @override
  String get paused => 'इनवाइट अभी रुके हुए हैं। आपके मिले इनाम सुरक्षित हैं।';

  @override
  String get codeDisabled => 'जाँच पूरी होने तक आपका कोड रुका हुआ है। आपके मिले इनाम सुरक्षित हैं।';

  @override
  String get loadFailed => 'आपके इनवाइट लोड नहीं हो सके। कनेक्शन देखकर फिर कोशिश करें।';

  @override
  String get retry => 'फिर कोशिश करें';

  @override
  String get notAvailable => 'इनवाइट अभी उपलब्ध नहीं हैं। जल्द ही फिर देखें।';

  @override
  String get notAvailableCodeKept =>
      'इनवाइट कोड अभी उपलब्ध नहीं हैं। आपका कोड सेव है, उपलब्ध होते ही हम इसे जोड़ देंगे।';

  @override
  String get dismiss => 'ठीक है';

  @override
  String get enterCodeTitle => 'क्या आपके पास इनवाइट कोड है?';

  @override
  String get codeFieldLabel => 'इनवाइट कोड';

  @override
  String get addCode => 'कोड जोड़ें';

  @override
  String useCode(String code) {
    return 'कोड $code इस्तेमाल करें';
  }

  @override
  String get enterDifferentCode => 'दूसरा कोड डालें';

  @override
  String get paste => 'पेस्ट करें';

  @override
  String windowCountdown(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'आप $days और दिनों तक इनवाइट कोड जोड़ सकते हैं',
      one: 'आप 1 और दिन तक इनवाइट कोड जोड़ सकते हैं',
    );
    return '$_temp0';
  }

  @override
  String windowOver(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'इनवाइट कोड सिर्फ़ पहले $days दिनों में जोड़े जा सकते हैं',
      one: 'इनवाइट कोड सिर्फ़ पहले दिन में जोड़े जा सकते हैं',
    );
    return '$_temp0';
  }

  @override
  String get claimOk => 'कोड जुड़ गया।';

  @override
  String get offlineQueued => 'ऑनलाइन होते ही हम आपका कोड लगा देंगे।';

  @override
  String get errOwnCode => 'यह आपका अपना कोड है। इसे किसी दोस्त से शेयर करें।';

  @override
  String get errAlreadyReferred => 'आप पहले ही एक इनवाइट कोड इस्तेमाल कर चुके हैं।';

  @override
  String get errUnknownCode =>
      'हमें यह कोड नहीं मिला। कोड में 8 अक्षर या अंक होते हैं और इनमें O, 0, I, 1 या L कभी नहीं होते।';

  @override
  String errWindowClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'इनवाइट कोड पहले $days दिनों में जोड़े जा सकते हैं।',
      one: 'इनवाइट कोड पहले दिन में जोड़े जा सकते हैं।',
    );
    return '$_temp0';
  }

  @override
  String errRateLimited(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'बहुत ज़्यादा कोशिशें। $minutes मिनट बाद फिर कोशिश करें।',
      one: 'बहुत ज़्यादा कोशिशें। 1 मिनट बाद फिर कोशिश करें।',
    );
    return '$_temp0';
  }

  @override
  String get errNotVerified => 'अपना ईमेल कन्फ़र्म करें, फिर हम आपका कोड जोड़ देंगे।';

  @override
  String get errSameInstall => 'यह कोड इस डिवाइस पर इस्तेमाल नहीं हो सकता।';

  @override
  String get errProgramPaused => 'इनवाइट अभी रुके हुए हैं।';

  @override
  String get errUnavailable => 'इस अकाउंट के लिए इनवाइट उपलब्ध नहीं हैं।';

  @override
  String get errGeneric => 'हम अभी यह कोड नहीं जोड़ सके। बाद में फिर कोशिश करें।';

  @override
  String rewardMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count मिनट', one: '1 मिनट');
    return '$_temp0';
  }

  @override
  String rewardEntitlementDays(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$name के $count दिन',
      one: '$name का 1 दिन',
    );
    return '$_temp0';
  }

  @override
  String rewardOther(String amount, String kind) {
    return '$amount $kind';
  }

  @override
  String giftWaiting(String reward) {
    return 'आपके लिए एक तोहफ़ा इंतज़ार कर रहा है: $reward';
  }

  @override
  String get giftWaitingPlain => 'एक दोस्त का तोहफ़ा आपका इंतज़ार कर रहा है';

  @override
  String daysLeftToAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'कोड जोड़ने के लिए सिर्फ़ $count दिन बाकी',
      one: 'कोड जोड़ने का आख़िरी दिन',
    );
    return '$_temp0';
  }

  @override
  String get stepsTitle => 'यह कैसे मिलेगा';

  @override
  String get stepAddCode => 'अपने दोस्त का कोड जोड़ें';

  @override
  String stepStartUsing(String app) {
    return '$app इस्तेमाल करना शुरू करें';
  }

  @override
  String stepRewardYou(String reward) {
    return '$reward आपके खाते में आ जाएगा';
  }

  @override
  String stepRewardBoth(String reward) {
    return '$reward आपको और आपके दोस्त को मिलेगा';
  }

  @override
  String get stepGift => 'आपका तोहफ़ा खुल जाएगा';

  @override
  String get almostTitle => 'लगभग आपका';

  @override
  String almostLine(String reward) {
    return 'ऐप इस्तेमाल करना शुरू करें और आपका $reward खुल जाएगा।';
  }

  @override
  String almostLineBoth(String reward) {
    return 'ऐप इस्तेमाल करना शुरू करें और आपका $reward खुल जाएगा। आपके दोस्त को भी उनका मिलेगा।';
  }

  @override
  String get almostLinePlain => 'ऐप इस्तेमाल करना शुरू करें और आपका तोहफ़ा खुल जाएगा।';

  @override
  String get almostProgress => '2 में से 1 पूरा: कोड जुड़ गया';

  @override
  String cannotAddClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'कोड पहले $days दिनों के लिए हैं, और आपके वे दिन बीत गए।',
      one: 'कोड सिर्फ़ पहले दिन के लिए हैं, और आपका वह दिन बीत गया।',
    );
    return '$_temp0';
  }

  @override
  String cannotAddNotEligible(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'दोस्त का कोड एक बार, पहले $days दिनों में जोड़ा जा सकता है। यह खाता अभी कोड नहीं जोड़ सकता।',
      one: 'दोस्त का कोड एक बार, पहले दिन में जोड़ा जा सकता है। यह खाता अभी कोड नहीं जोड़ सकता।',
    );
    return '$_temp0';
  }

  @override
  String noLinkHint(String app) {
    return 'आपका दोस्त ऐप स्टोर से $app लेकर यह कोड डालता है।';
  }

  @override
  String shareTextNoLinkBoth(String app, String code, String reward, String link) {
    return 'मैं $app इस्तेमाल कर रहा हूँ। इसे लें, मेरा इनवाइट कोड $code जोड़ें और हम दोनों को $reward मिलेगा: $link';
  }

  @override
  String shareTextNoLinkFriend(String app, String code, String reward, String link) {
    return 'मैं $app इस्तेमाल कर रहा हूँ। इसे लें, मेरा इनवाइट कोड $code जोड़ें और आपको $reward मिलेगा: $link';
  }

  @override
  String shareTextNoLinkPlain(String app, String code, String link) {
    return 'मैं $app इस्तेमाल कर रहा हूँ। इसे लें और मेरा इनवाइट कोड $code जोड़ें: $link';
  }

  @override
  String shareTextCodeOnly(String app, String code) {
    return 'मैं $app इस्तेमाल कर रहा हूँ। इसे लें और मेरा इनवाइट कोड $code जोड़ें।';
  }

  @override
  String get signInToInvite => 'अपना इनवाइट कोड पाने और दोस्त का कोड जोड़ने के लिए साइन इन करें।';

  @override
  String get signIn => 'साइन इन करें';

  @override
  String get notInThisVersion => 'इनवाइट ऐप के इस वर्ज़न में नहीं हैं।';
}
