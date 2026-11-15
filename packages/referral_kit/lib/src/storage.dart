import 'package:shared_preferences/shared_preferences.dart';

/// Small string store used by the pending-claim queue, the prompt policy, the install-referrer reader and the code
/// cache. Apps may back it with anything; [SharedPreferencesKeyValueStore] is the default.
abstract class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

/// [KeyValueStore] over `SharedPreferencesAsync`. Keys are prefixed with `referral_kit.`.
class SharedPreferencesKeyValueStore implements KeyValueStore {
  SharedPreferencesKeyValueStore({SharedPreferencesAsync? prefs}) : _prefs = prefs ?? SharedPreferencesAsync();

  final SharedPreferencesAsync _prefs;
  static const _prefix = 'referral_kit.';

  @override
  Future<String?> getString(String key) => _prefs.getString('$_prefix$key');

  @override
  Future<void> setString(String key, String value) => _prefs.setString('$_prefix$key', value);

  @override
  Future<void> remove(String key) => _prefs.remove('$_prefix$key');
}

/// In-memory [KeyValueStore], for tests and for apps that do not want anything persisted.
class MemoryKeyValueStore implements KeyValueStore {
  MemoryKeyValueStore([Map<String, String>? initial]) : values = {...?initial};

  final Map<String, String> values;

  @override
  Future<String?> getString(String key) async => values[key];

  @override
  Future<void> setString(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}
