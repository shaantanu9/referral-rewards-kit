import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

void main() {
  late MemoryKeyValueStore store;
  late DateTime now;
  ReferralPromptPolicy policy() => ReferralPromptPolicy(store: store, clock: () => now);

  setUp(() {
    store = MemoryKeyValueStore();
    now = DateTime.utc(2026, 11, 1, 12);
  });

  Future<ReferralPromptPolicy> session() async {
    final p = policy();
    await p.startSession();
    return p;
  }

  test('never in the first session, even after a moment of value', () async {
    final p = await session();
    p.reportMomentOfValue();
    expect(await p.shouldPrompt(), isFalse);
  });

  test('second session: only after a moment of value', () async {
    await session();
    final p = await session();
    expect(await p.shouldPrompt(), isFalse);
    p.reportMomentOfValue();
    expect(await p.shouldPrompt(), isTrue);
  });

  test('at most one prompt per 14 days', () async {
    await session();
    var p = await session();
    p.reportMomentOfValue();
    await p.markPrompted();
    expect(await p.shouldPrompt(), isFalse, reason: 'moment used up');
    now = now.add(const Duration(days: 13, hours: 23));
    p = await session();
    p.reportMomentOfValue();
    expect(await p.shouldPrompt(), isFalse);
    now = now.add(const Duration(hours: 1));
    expect(await p.shouldPrompt(), isTrue);
  });

  test('never during a purchase, nor later in that session', () async {
    await session();
    final p = await session();
    p.reportMomentOfValue();
    p.reportPurchaseStarted();
    expect(await p.shouldPrompt(), isFalse);
    await p.reportPurchaseFinished();
    expect(await p.shouldPrompt(), isFalse);
  });

  test('not within 24 hours after a purchase, across sessions', () async {
    await session();
    final p = await session();
    p.reportPurchaseStarted();
    await p.reportPurchaseFinished();
    now = now.add(const Duration(hours: 23));
    final next = await session();
    next.reportMomentOfValue();
    expect(await next.shouldPrompt(), isFalse);
    now = now.add(const Duration(hours: 1));
    expect(await next.shouldPrompt(), isTrue);
  });

  test('session count persists in the store', () async {
    await session();
    await session();
    expect(store.values['prompt.sessions'], '2');
  });
}
