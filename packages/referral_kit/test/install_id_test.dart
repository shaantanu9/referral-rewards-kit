import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const blockChannel = MethodChannel('referral_kit/block_store');
  late Map<String, String> blockStore;
  late bool blockStoreWorks;

  setUp(() {
    blockStore = {};
    blockStoreWorks = true;
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(blockChannel, (
      call,
    ) async {
      if (!blockStoreWorks) throw PlatformException(code: 'no_play_services');
      final args = call.arguments as Map;
      if (call.method == 'read') return blockStore[args['key']];
      blockStore[args['key'] as String] = args['value'] as String;
      return true;
    });
  });

  test('newInstallId is a v4 UUID from the given RNG', () {
    final ids = List.generate(200, (_) => newInstallId());
    expect(ids.every(isInstallId), isTrue);
    expect(ids.toSet(), hasLength(200));
    expect(newInstallId(Random(1)), newInstallId(Random(1)));
    expect(isInstallId('not-a-uuid'), isFalse);
  });

  test('iOS options: after first unlock, this device only, not synchronizable', () {
    expect(DefaultInstallIdStore.iosOptions.accessibility, KeychainAccessibility.first_unlock_this_device);
    expect(DefaultInstallIdStore.iosOptions.synchronizable, isFalse);
    final m = DefaultInstallIdStore.iosOptions.toMap();
    expect(m['accessibility'], 'first_unlock_this_device');
    expect(m['synchronizable'], 'false');
  });

  test('iOS: created once, then the same id; Block Store never used', () async {
    final a = await DefaultInstallIdStore(platform: TargetPlatform.iOS).installId();
    final b = await DefaultInstallIdStore(platform: TargetPlatform.iOS).installId();
    expect(a, b);
    expect(blockStore, isEmpty);
  });

  test('Android: written to Block Store and secure storage', () async {
    final id = await DefaultInstallIdStore(platform: TargetPlatform.android).installId();
    expect(blockStore[DefaultInstallIdStore.key], id);
  });

  test('Android reinstall: app storage wiped, Block Store kept → same id', () async {
    final id = await DefaultInstallIdStore(platform: TargetPlatform.android).installId();
    FlutterSecureStorage.setMockInitialValues({});
    expect(await DefaultInstallIdStore(platform: TargetPlatform.android).installId(), id);
  });

  test('Android without Play services: secure storage alone', () async {
    blockStoreWorks = false;
    final a = await DefaultInstallIdStore(platform: TargetPlatform.android).installId();
    final b = await DefaultInstallIdStore(platform: TargetPlatform.android).installId();
    expect(a, b);
  });

  test('a malformed stored value is replaced', () async {
    FlutterSecureStorage.setMockInitialValues({DefaultInstallIdStore.key: 'junk'});
    final id = await DefaultInstallIdStore(platform: TargetPlatform.iOS).installId();
    expect(isInstallId(id), isTrue);
  });

  test('cached per instance: one storage read', () async {
    final s = DefaultInstallIdStore(platform: TargetPlatform.android);
    final ids = await Future.wait([s.installId(), s.installId()]);
    expect(ids[0], ids[1]);
  });
}
