import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Supplies the install id every RPC takes (ADR 7, 8): a random UUID, never an advertising id.
abstract class InstallIdStore {
  Future<String> installId();
}

/// Random UUID version 4 from [Random.secure].
String newInstallId([Random? random]) {
  final r = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

final RegExp _uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

/// Whether [v] looks like an id this package wrote (anything else is replaced).
bool isInstallId(String? v) => v != null && _uuid.hasMatch(v);

/// Key-value access to Android Block Store through this package's own Kotlin code (`BlockStoreChannel.kt`).
/// Every call fails soft: no Google Play services, or any error, reads as "nothing stored".
class BlockStore {
  const BlockStore([this._channel = const MethodChannel('referral_kit/block_store')]);
  final MethodChannel _channel;

  Future<String?> read(String key) async {
    try {
      return await _channel.invokeMethod<String>('read', {'key': key});
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  Future<bool> write(String key, String value) async {
    try {
      return await _channel.invokeMethod<bool>('write', {'key': key, 'value': value}) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

/// The default [InstallIdStore].
///
/// - iOS: Keychain item, accessibility "after first unlock, this device only", not synchronizable (no iCloud
///   Keychain), through `flutter_secure_storage`.
/// - Android: Google Block Store with cloud backup off (survives uninstall and reinstall on the same phone when the
///   user has Google backup on; may move to a new phone during device-to-device setup), mirrored in
///   `flutter_secure_storage` (Android Keystore; lost on uninstall) as the fallback when Play services are missing.
/// - Other platforms: `flutter_secure_storage` defaults.
///
/// The value is read once per process and cached.
class DefaultInstallIdStore implements InstallIdStore {
  DefaultInstallIdStore({
    FlutterSecureStorage? storage,
    BlockStore? blockStore,
    Random? random,
    TargetPlatform? platform,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _blockStore = blockStore ?? const BlockStore(),
       _random = random,
       _platform = platform;

  /// Storage key, in the Keychain, Block Store and the Android fallback.
  static const key = 'referral_kit.install_id';

  /// iOS Keychain options required by ADR 8.
  static const iosOptions = IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
    synchronizable: false,
  );

  final FlutterSecureStorage _storage;
  final BlockStore _blockStore;
  final Random? _random;
  final TargetPlatform? _platform;
  Future<String>? _pending;

  TargetPlatform get _os => _platform ?? defaultTargetPlatform;

  @override
  Future<String> installId() => _pending ??= _load().catchError((Object e) {
    _pending = null;
    throw e;
  });

  Future<String?> _readSecure() async {
    try {
      return await _storage.read(key: key, iOptions: iosOptions);
    } on PlatformException {
      return null;
    }
  }

  Future<void> _writeSecure(String v) async {
    try {
      await _storage.write(key: key, value: v, iOptions: iosOptions);
    } on PlatformException {
      // Not fatal: the id still works for this run.
    }
  }

  Future<String> _load() async {
    final android = !kIsWeb && _os == TargetPlatform.android;
    if (android) {
      final fromBlockStore = await _blockStore.read(key);
      if (isInstallId(fromBlockStore)) {
        await _writeSecure(fromBlockStore!);
        return fromBlockStore;
      }
    }
    final fromSecure = await _readSecure();
    if (isInstallId(fromSecure)) {
      if (android) await _blockStore.write(key, fromSecure!);
      return fromSecure!;
    }
    final fresh = newInstallId(_random);
    await _writeSecure(fresh);
    if (android) await _blockStore.write(key, fresh);
    return fresh;
  }
}

/// [InstallIdStore] with a fixed value, for tests.
class FixedInstallIdStore implements InstallIdStore {
  const FixedInstallIdStore(this.id);
  final String id;
  @override
  Future<String> installId() async => id;
}
