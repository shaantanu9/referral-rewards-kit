#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint referral_kit.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'referral_kit'
  s.version          = '0.1.0'
  s.summary          = 'Referral kit: install id, invite screens, native Paste control.'
  s.description      = <<-DESC
Invite-friends screens and invite-code entry for referral-kit. iOS side: the UIPasteControl platform view.
                       DESC
  s.homepage         = 'https://github.com/shaantanu9/referral-rewards-kit'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'referral-kit contributors' => 'noreply@example.com' }
  s.source           = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform = :ios, '15.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'

  # If your plugin requires a privacy manifest, for example if it uses any
  # required reason APIs, update the PrivacyInfo.xcprivacy file to describe your
  # plugin's privacy impact, and then uncomment this line. For more information,
  # see https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
  s.resource_bundles = {'referral_kit_privacy' => ['Resources/PrivacyInfo.xcprivacy']}
end
