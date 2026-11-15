import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'gen/referral_kit_localizations.dart';

/// The package's strings for every locale: the language when the package has it (en, hi, id), English otherwise.
/// Use this instead of `ReferralKitLocalizations.delegate` so an app in a language the package lacks (for example
/// Arabic) still gets the referral screens, with no "locale not supported" warning.
class ReferralKitLocalizationsDelegate extends LocalizationsDelegate<ReferralKitLocalizations> {
  const ReferralKitLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<ReferralKitLocalizations> load(Locale locale) {
    final supported = ReferralKitLocalizations.delegate.isSupported(locale);
    return SynchronousFuture(lookupReferralKitLocalizations(supported ? locale : const Locale('en')));
  }

  @override
  bool shouldReload(ReferralKitLocalizationsDelegate old) => false;
}

/// Add to `MaterialApp.localizationsDelegates`.
const referralKitLocalizationsDelegate = ReferralKitLocalizationsDelegate();
