/// macOS, Windows and Linux: the package is Dart and widgets there, with no native code of its own.
///
/// What differs from the phones: the install id lives only in `flutter_secure_storage` (no Block Store), so it does
/// not survive a reinstall, and if the keychain / libsecret is unavailable a new id is made each launch (the claim
/// still works; the one-reward-per-install check is weaker). Paste is the text field's own menu. The Play install
/// referrer is Android only and reads as null.
library;

/// Registered by Flutter for the desktop platforms (`dartPluginClass` in pubspec.yaml). Nothing to set up.
class ReferralKitDesktop {
  ReferralKitDesktop._();

  /// Called once by the generated plugin registrant.
  static void registerWith() {}
}
