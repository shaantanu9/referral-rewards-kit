/// Tolerant JSON readers shared by the models. Not exported.
library;

import 'dart:convert';

import 'errors.dart';

/// Decodes a JSON string result (raw HTTP adapters) and passes anything else through.
Object? decodeResult(Object? v) => v is String ? jsonDecode(v) : v;

Map<String, Object?> asMap(Object? v, String what) {
  if (v is Map) return v.map((k, value) => MapEntry(k.toString(), value));
  throw RewardsFormatException('$what: expected an object, got ${v.runtimeType}');
}

/// A map, or empty for anything else (optional `params` / `public` objects).
Map<String, Object?> optMap(Object? v) => v is Map ? v.map((k, value) => MapEntry(k.toString(), value)) : const {};

List<Object?> asList(Object? v, String what) {
  if (v == null) return const [];
  if (v is List) return v;
  throw RewardsFormatException('$what: expected a list, got ${v.runtimeType}');
}

/// Parses each item of an optional list with [f], skipping items that are not objects.
List<T> listOf<T>(Object? v, T Function(Map<String, Object?> m) f) {
  if (v is! List) return const [];
  return [
    for (final item in v)
      if (item is Map) f(optMap(item)),
  ];
}

int? optInt(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
int intOr(Object? v, [int fallback = 0]) => optInt(v) ?? fallback;
num numOr(Object? v, [num fallback = 0]) => v is num ? v : (v is String ? num.tryParse(v) ?? fallback : fallback);
bool boolOr(Object? v, [bool fallback = false]) => v is bool ? v : (v is String ? v == 'true' : fallback);
String str(Object? v) => v?.toString() ?? '';
String? optStr(Object? v) => v?.toString();

/// A chance 0 < c ≤ 1 (`params.chance`), or null for anything else (missing, 0, negative, above 1, not a number).
double? optChance(Object? v) {
  final n = v is num ? v : (v is String ? num.tryParse(v) : null);
  if (n == null || n.isNaN || n <= 0 || n > 1) return null;
  return n.toDouble();
}

/// `[min, max]` whole numbers with 0 ≤ min ≤ max (`params.amount_range`, a grant's `params.range`), or null.
(int, int)? optRange(Object? v) {
  if (v is! List || v.length != 2) return null;
  int? whole(Object? x) {
    final n = x is num ? x : (x is String ? num.tryParse(x) : null);
    if (n == null || !n.isFinite || n != n.roundToDouble()) return null;
    return n.toInt();
  }

  final lo = whole(v[0]), hi = whole(v[1]);
  if (lo == null || hi == null || lo < 0 || lo > hi) return null;
  return (lo, hi);
}

final _zone = RegExp(r'(Z|[+-]\d\d(:?\d\d)?)$', caseSensitive: false);

/// An ISO 8601 time as UTC. A time without a zone is read as UTC (the server sends UTC), never as phone-local.
DateTime? time(Object? v) {
  if (v is! String || v.isEmpty) return null;
  final text = _zone.hasMatch(v) ? v : '${v}Z';
  return DateTime.tryParse(text)?.toUtc();
}
