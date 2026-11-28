# ADR 0003: Free kit as a backlink and distribution engine

**Status:** Accepted
**Date:** 2026-11-27
**Type:** Flutter Package (Dart / pub.dev)
**Scope:** Flutter package, pub.dev, GitHub, Site, Apps


> **Amended 2026-11-27 by the owner's decisions** ([plan](../growth/attribution-and-multiplatform-plan.md)):
> attribution is **on by default and free to remove**: there is no forced attribution, no licence key and no licence
> change, and MIT stays (a custom clause is not OSI-approved, which costs pub.dev points, and 0.5/0.7 are already
> MIT). The link shows on top-level screens only. Scope widened to React, Next.js and React Native ports at full
> parity. Where the text below says "force", "Pro key" or "LICENSE clause", the amendment wins.

---

## 1. Context

We have a FREE Flutter package on pub.dev / GitHub.

Goal is NOT to charge for the package itself. Goal is:
1. Get mentions + dofollow backlinks to rank our Site
2. Rank our GitHub repo (stars, forks, dependents)
3. Rank / distribute our Apps (Flutter apps on Play Store / App Store / Web)
4. Compounding growth: More Flutter devs use it -> More apps show attribution -> More devs discover it

Problem with Flutter specifically:
- Flutter apps are compiled to native / web. Google cannot crawl inside an APK like it can crawl a website.
- So a footer link inside a Flutter app does NOT directly give you a Google backlink.
- BUT it gives you: Brand impressions, dev discovery, GitHub stars, pub.dev likes, and - most important - links from the dev's WEBSITE / GitHub README / Portfolio / Play Store listing.

So for Flutter, strategy is 2-layer:
- **Layer 1 (In-App):** Attribution widget inside the app -> Drives discovery + Play Store mentions
- **Layer 2 (Out-of-App):** Attribution in README, pub.dev, GitHub, Showcase, Portfolio -> Drives real SEO backlinks

This ADR implements both.

---

## 2. Decision

We adopt **Free + Attribution** model for Flutter.

> Free to use = Yes
> Free to remove attribution = No (Pro license required)

Attribution is a core prop of the package, not an afterthought.

**Rules:**
1. Every public widget that renders UI MUST accept `showAttribution` (default `true`)
2. If user passes `showAttribution: false` without a valid Pro license key, we FORCE it back to `true` + show debug warning
3. Attribution widget must be small, professional, tappable, opens our site
4. Provide Pro path to remove it legally

We will NOT:
- Hide links, use 0px font, invisible widget
- Block the app if attribution is removed (just force it back)
- Collect personal data, device IDs, user data secretly
- Use cloaking / bought links

---

## 3. Flutter Package Structure

```
your_package/
  lib/
    your_package.dart              # Main export
    src/
      config/
        attribution_config.dart
      widgets/
        attribution_widget.dart
        your_main_widget.dart      # Example: YourPackageWidget
      license/
        license_verifier.dart
      utils/
        url_launcher_helper.dart
  example/
    lib/main.dart                  # Demo app - MUST show attribution
  test/
    attribution_test.dart
  README.md
  CHANGELOG.md
  LICENSE
  pubspec.yaml
  SHOWCASE.md
  assets/
    badge.svg
```

---

## 4. Implementation - Step by Step in Codebase

### STEP 1: Attribution Config - Single Source of Truth

**File:** `lib/src/config/attribution_config.dart`

```dart
class AttributionConfig {
  static const String brandName = 'YourPackage';
  static const String defaultText = 'Built with YourPackage';

  // Rotate these - do NOT use same anchor everywhere
  static const List<Map<String, String>> variants = [
    {'text': 'Built with YourPackage', 'url': 'https://your-site.com'},
    {'text': 'Powered by YourPackage', 'url': 'https://your-site.com/package'},
    {'text': 'YourPackage - Free Flutter Tool', 'url': 'https://your-site.com/package'},
    {'text': 'Made with YourPackage', 'url': 'https://your-site.com/docs'},
  ];

  static const String showcaseUrl = 'https://your-site.com/showcase';
  static const String githubUrl = 'https://github.com/you/yourpackage';
  static const String pubDevUrl = 'https://pub.dev/packages/your_package';
  static const String proUrl = 'https://your-site.com/pro';
}
```

**Why this file:** If you ever change URL, you change it in 1 place, not 50 widgets.

### STEP 2: Attribution Widget

**File:** `lib/src/widgets/attribution_widget.dart`

This is the most important widget in the package.

```dart
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/attribution_config.dart';

class YourPackageAttribution extends StatelessWidget {
  final int variant;
  final TextStyle? textStyle;
  final EdgeInsetsGeometry padding;

  const YourPackageAttribution({
    super.key,
    this.variant = 0,
    this.textStyle,
    this.padding = const EdgeInsets.only(top: 8, bottom: 8),
  });

  @override
  Widget build(BuildContext context) {
    final link = AttributionConfig.variants[variant % AttributionConfig.variants.length];
    final text = link['text']!;
    final url = link['url']!;

    return Padding(
      padding: padding,
      child: Center(
        child: GestureDetector(
          onTap: () async {
            final uri = Uri.parse(url);
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
          },
          child: Text(
            text,
            style: textStyle ?? TextStyle(
              fontSize: 11,
              color: Colors.grey.shade500,
              decoration: TextDecoration.none,
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
```

**Design Rules:**
- Font size 11-12, grey, centered - NOT big, NOT ad-like
- Must be tappable - opens browser via `url_launcher`
- Must be visible - never `Opacity(0)`, never `SizedBox.shrink()` to hide
- Add `Semantics` label for accessibility in real code

### STEP 3: Add `showAttribution` to EVERY Public Widget

Example: If your package is a Form / Card / Picker / Chart / Resume widget - do this pattern for ALL of them.

**File:** `lib/src/widgets/your_main_widget.dart`

```dart
import 'package:flutter/material.dart';
import 'attribution_widget.dart';
import '../license/license_verifier.dart';

class YourPackageWidget extends StatelessWidget {
  final bool showAttribution;
  final String? licenseKey;
  final int attributionVariant;
  // ... your other params
  final Widget child;

  const YourPackageWidget({
    super.key,
    required this.child,
    this.showAttribution = true,
    this.licenseKey,
    this.attributionVariant = 0,
  });

  @override
  Widget build(BuildContext context) {
    // CORE LOGIC: Force attribution ON if no Pro license
    final bool isPro = LicenseVerifier.isProSync(licenseKey);
    final bool shouldShow = showAttribution || !isPro;

    if (!showAttribution && !isPro) {
      // Show in debug only, don't crash app
      debugPrint(
        '[YourPackage] Attribution is required on Free plan. '
        'Get Pro to remove: https://your-site.com/pro'
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Expanded(child: child), // Your actual widget UI
        if (shouldShow)
          YourPackageAttribution(variant: attributionVariant),
      ],
    );
  }
}
```

**Checklist for every widget:**
- [ ] Has `showAttribution = true` by default
- [ ] Has `licenseKey` param
- [ ] Calls `LicenseVerifier`
- [ ] Renders `YourPackageAttribution` at bottom if `shouldShow`
- [ ] Does NOT throw if user tries to hide without Pro - just forces ON

### STEP 4: License Verifier (Pro Check)

**File:** `lib/src/license/license_verifier.dart`

For MVP, keep it simple. Don't over-engineer.

```dart
class LicenseVerifier {
  // Sync check for UI - fast, offline
  // For real Pro, you validate key format + cache result
  static bool isProSync(String? key) {
    if (key == null || key.isEmpty) return false;
    // Example: Pro keys start with "YP-PRO-"
    // Real implementation: call your API once and cache in SharedPreferences
    return key.startsWith('YP-PRO-') && key.length > 12;
  }

  // Async check - call your API
  static Future<bool> verifyWithServer(String key) async {
    // TODO: POST https://your-site.com/api/verify-license
    // Body: { key: key, package: 'your_package', platform: 'flutter' }
    // Cache result for 7 days
    // If API fails -> return false (default to Free, attribution ON)
    return isProSync(key);
  }
}
```

**Important:** If API fails, default to Free (attribution ON). Never default to Pro.

Later you can add: RevenueCat / LemonSqueezy / Stripe verification.

### STEP 5: Main Export File

**File:** `lib/your_package.dart`

```dart
library your_package;

export 'src/config/attribution_config.dart';
export 'src/widgets/attribution_widget.dart';
export 'src/widgets/your_main_widget.dart';
export 'src/license/license_verifier.dart';
// Export all your other widgets here
```

### STEP 6: Example App - This is Your Demo for SEO

**File:** `example/lib/main.dart`

The example app is what developers copy-paste. It MUST show attribution and MUST link to you.

```dart
import 'package:flutter/material.dart';
import 'package:your_package/your_package.dart';

void main() => runApp(const DemoApp());

class DemoApp extends StatelessWidget {
  const DemoApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('YourPackage Demo')),
        body: YourPackageWidget(
          // Do NOT set showAttribution: false here
          // Let it show by default so devs see it
          child: const Center(child: Text('Your content here')),
        ),
      ),
    );
  }
}
```

Also add in example README: "Built with YourPackage - https://your-site.com"

### STEP 7: Tests - Attribution Cannot Be Bypassed

**File:** `test/attribution_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:your_package/your_package.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets('Attribution shows by default', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: YourPackageWidget(child: Text('Hello')),
      ),
    );
    expect(find.text('Built with YourPackage'), findsOneWidget);
  });

  testWidgets('Attribution forced ON without Pro key', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: YourPackageWidget(
          showAttribution: false, // Trying to hide without Pro
          child: Text('Hello'),
        ),
      ),
    );
    // Should still show because no Pro key
    expect(find.text('Built with YourPackage'), findsOneWidget);
  });

  testWidgets('Attribution hides with Pro key', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: YourPackageWidget(
          showAttribution: false,
          licenseKey: 'YP-PRO-123456789',
          child: Text('Hello'),
        ),
      ),
    );
    expect(find.text('Built with YourPackage'), findsNothing);
  });
}
```

Run: `flutter test`

---

## 5. pubspec.yaml - Critical for pub.dev Ranking

**File:** `pubspec.yaml`

```yaml
name: your_package
description: Free Flutter [what it does] - Built with YourPackage. Free, customizable, with attribution.
version: 1.0.0
homepage: https://your-site.com/package
repository: https://github.com/you/yourpackage
issue_tracker: https://github.com/you/yourpackage/issues
documentation: https://your-site.com/docs

environment:
  sdk: '>=3.0.0 <4.0.0'
  flutter: '>=3.10.0'

dependencies:
  flutter:
    sdk: flutter
  url_launcher: ^6.2.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

topics:
  - widget
  - free
  - your-category
```

**pub.dev ranking factors:** Likes, pub points, documentation, homepage link. Make sure `homepage` points to your site, not just GitHub.

### pub.dev README trick:
pub.dev shows your README.md as the package page. So your README IS your landing page. Put links there.

---

## 6. README.md - For GitHub + pub.dev (Same File)

This file is used by BOTH GitHub and pub.dev. Optimize it for both.

```md
# YourPackage - Free Flutter [What It Does]

[![Built with YourPackage](https://your-site.com/badge.svg)](https://your-site.com)
[![pub package](https://img.shields.io/pub/v/your_package.svg)](https://pub.dev/packages/your_package)
[![GitHub stars](https://img.shields.io/github/stars/you/yourpackage)](https://github.com/you/yourpackage)

> Free Flutter widget to [do X]. Built by [Your Brand].

**Live Demo:** https://your-site.com/demo
**Docs:** https://your-site.com/docs
**Showcase:** https://your-site.com/showcase
**Our Apps:** https://your-site.com/apps

## Install

```yaml
dependencies:
  your_package: ^1.0.0
```

## Quick Start

```dart
import 'package:your_package/your_package.dart';

YourPackageWidget(
  child: YourContent(),
  // showAttribution defaults to true on Free plan
)
```

## Showcase

Built something with YourPackage? Add it here -> https://your-site.com/showcase
We feature you + give you a backlink.

## Attribution

Free version includes a small "Built with YourPackage" link at the bottom.
Remove it with Pro: https://your-site.com/pro

```dart
// Pro only
YourPackageWidget(
  showAttribution: false,
  licenseKey: 'YP-PRO-XXXX',
  child: YourContent(),
)
```

## Our Other Flutter Apps

- [App 1](https://play.google.com/store/apps/details?id=com.you.app1) - [What it does]
- [App 2](https://your-site.com/apps) - [What it does]
```

---

## 7. How to Get REAL Backlinks from Flutter (Since APK Links Don't Count for Google)

This is the key difference for Flutter. You need 5 out-of-app link sources:

### 7.1 Developer Portfolio / Website Link
When a dev uses your package in a client project, they usually have a portfolio site. Ask them:
"Add our badge to your project README / footer, we'll feature you on Showcase with a backlink."

### 7.2 GitHub README Link
Every Flutter app has a GitHub repo. Your package's `example/` should encourage devs to add badge to THEIR repo README. That's a real GitHub backlink.

Provide copy-paste:

```md
[![Built with YourPackage](https://your-site.com/badge.svg)](https://your-site.com)
```

### 7.3 Play Store Description Link
Tell devs to add this line in Play Store description (Play Store descriptions ARE indexed by Google):

```
Built with YourPackage - Free Flutter Tool by YourBrand - https://your-site.com
```

And YOU do the same for YOUR apps: Link to your package + site in YOUR Play Store descriptions.

### 7.4 Showcase Page (Your Site)
Create `https://your-site.com/showcase`

Each showcase card:
- App screenshot
- App name + link to Play Store / Web / GitHub (dofollow)
- "Built with YourPackage" badge

Submission rule: To be featured, their app / repo must have attribution ON or badge in README.

This is a trade: They link you -> You link them.

### 7.5 Blog / Tutorial Links
Write 3 posts:
1. "How to build [X] in Flutter with YourPackage" -> links to pub.dev + GitHub
2. "YourPackage vs [Competitor]" -> comparison, ranks for competitor keywords
3. "10 Apps built with YourPackage" -> showcase roundup, each app links back

---

## 8. Site + GitHub + Apps Loop

```
Site (your-site.com)
  -> Links to GitHub + pub.dev + Apps

GitHub README
  -> Links to Site + pub.dev + Apps

pub.dev README
  -> Links to Site + GitHub + Apps

Play Store Description (Your Apps)
  -> Links to Site + GitHub

Showcase Page
  -> Links to User Apps (dofollow) + User GitHub
  <- User Apps link back to Site
```

Google sees this as a real ecosystem, not a link scheme.

---

## 9. LICENSE File

Add to LICENSE:

```
ATTRIBUTION REQUIREMENT:
You may use this Flutter package for free for personal and commercial
projects, provided that the attribution widget "Built with YourPackage"
remains visible in the UI where the package is used.

Removal of attribution requires a Pro license available at
https://your-site.com/pro

Full terms: https://your-site.com/license
```

---

## 10. Tracking Who Uses It (Flutter-Specific)

**Allowed:**
- pub.dev stats: Downloads, likes, pub points - check weekly
- GitHub Dependents: github.com/you/yourpackage/network/dependents
- Showcase submissions
- Pro license activations (email + app bundle ID)
- `flutter pub` search: Search GitHub for `your_package:` in pubspec.yaml

**Do NOT:**
- Send device ID, user data, app content, screenshots secretly
- Add hidden network call on every app launch without disclosure

**Optional Transparent Telemetry:**
If you want usage count, add ONLY in `example` / docs, not in main widget, and document it:
"Anonymous install count only. Opt-out: No telemetry in main package."

Best approach for Flutter: No runtime telemetry. Use pub.dev + GitHub + Showcase as source of truth. Devs trust you more.

---

## 11. Acceptance Criteria - Definition of Done

- [ ] `YourPackageAttribution` widget exists and is tappable
- [ ] All public widgets have `showAttribution` (default true) + `licenseKey`
- [ ] Test: `showAttribution: false` without Pro key still shows attribution
- [ ] Test: `showAttribution: false` with Pro key hides attribution
- [ ] `pubspec.yaml` homepage points to site, not just GitHub
- [ ] README has badge + links to Site, Showcase, Apps, pub.dev
- [ ] Example app shows attribution by default
- [ ] LICENSE has attribution clause
- [ ] Showcase page live
- [ ] Play Store descriptions of YOUR apps link to site + package
- [ ] `flutter analyze` passes, `flutter test` passes
- [ ] Published to pub.dev with `dart pub publish` (dry-run first)

---

## 12. 7-Day Implementation Plan

**Day 1:** Create `attribution_config.dart` + `attribution_widget.dart`
**Day 2:** Add `showAttribution` + `licenseKey` to all widgets + `license_verifier.dart`
**Day 3:** Write tests + update `example` app
**Day 4:** Update README + pubspec.yaml + LICENSE + SHOWCASE.md
**Day 5:** Create Showcase page on site + Pro page
**Day 6:** Publish to pub.dev + GitHub, create 2 demo apps using package
**Day 7:** Post on Dev.to, X, LinkedIn, Flutter communities + email first 20 users: "Add badge -> Get featured"

---

## 13. Risks

| Risk | Mitigation |
| :--- | :--- |
| Devs remove attribution manually | Accept 20-30% will. 70% who keep it is enough. Showcase incentivizes keeping. |
| Attribution looks like ad, bad UX | Keep 11px grey, small padding, not sticky, not blocking content |
| pub.dev score drops | Keep docs 100%, add example, add tests, keep changelog updated |
| Users complain | Explain: Free = Attribution, Pro = Remove. Fair trade. |

---

## TODO

1. Replace `YourPackage`, `your_package`, `your-site.com`, `you/yourpackage` with real names
2. Add `url_launcher` to pubspec.yaml
3. Implement Attribution widget FIRST, then add to other widgets
4. Run `flutter test` before publishing
