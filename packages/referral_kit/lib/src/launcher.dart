import 'package:url_launcher/url_launcher.dart' as url_launcher;

/// Opens links outside the app (the WhatsApp button, G5). Inject your own in tests or to route through the app's
/// link handling; [UrlLauncherReferralLauncher] is the default.
abstract class ReferralLauncher {
  /// Whether [uri] can be opened on this device. False hides the button.
  Future<bool> canLaunch(Uri uri);

  /// Opens [uri]; true when something opened it.
  Future<bool> launch(Uri uri);
}

/// [ReferralLauncher] over `url_launcher`, opening links in an external app. Never throws: a missing plugin or a
/// platform error reads as "cannot launch".
///
/// Android 11+ needs a `<queries>` entry for `https` VIEW intents in the app's manifest for [canLaunch] to be true
/// (see the package README, "WhatsApp button").
class UrlLauncherReferralLauncher implements ReferralLauncher {
  const UrlLauncherReferralLauncher();

  @override
  Future<bool> canLaunch(Uri uri) async {
    try {
      return await url_launcher.canLaunchUrl(uri);
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> launch(Uri uri) async {
    try {
      return await url_launcher.launchUrl(uri, mode: url_launcher.LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}

/// `https://wa.me/?text=<text>`: WhatsApp opens with [text] typed in and the user picks the chat. Nothing is sent
/// by the app (no contact upload, no message in the user's name).
Uri whatsAppShareUri(String text) => Uri.parse('https://wa.me/?text=${Uri.encodeComponent(text)}');
