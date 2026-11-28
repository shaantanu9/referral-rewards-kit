import { formatIcu } from './icu';
import {
  referralMessageParams,
  referralMessagesEn,
  referralMessagesHi,
  referralMessagesId,
  type ReferralKitLocalizations,
  type ReferralMessageKey,
} from './messages';

export { formatIcu } from './icu';
export {
  referralMessageParams,
  referralMessagesEn,
  referralMessagesHi,
  referralMessagesId,
  type ReferralKitLocalizations,
  type ReferralMessageKey,
} from './messages';

/** The languages the kit ships (the Flutter package's ARB files). */
export const supportedReferralLocales = ['en', 'hi', 'id'] as const;
export type SupportedReferralLocale = (typeof supportedReferralLocales)[number];

/** The raw ICU messages per shipped language. `hi` and `id` fall back to English for a key they lack. */
export const referralMessages: Readonly<Record<SupportedReferralLocale, Readonly<Partial<Record<ReferralMessageKey, string>>>>> = {
  en: referralMessagesEn,
  hi: referralMessagesHi,
  id: referralMessagesId,
};

/** `hi-IN`, `hi_IN`, `HI` → `hi`; a language the kit lacks → null. */
export function resolveReferralLocale(locale: string | null | undefined): SupportedReferralLocale | null {
  const lang = (locale ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return (supportedReferralLocales as readonly string[]).includes(lang) ? (lang as SupportedReferralLocale) : null;
}

type Fn<K extends ReferralMessageKey> = ReferralKitLocalizations[K] extends (...args: infer A) => string
  ? (...args: A) => string
  : string;

/**
 * Per-key overrides: an ICU string with the same placeholders as the ARB message (`'{count} pals joined'`), or for a
 * message with placeholders a function with the same parameters as the Dart method. Use it for the app's own voice or
 * a language the kit lacks (give every key). Equivalent to the Flutter app's own `ReferralKitLocalizations`.
 */
export type ReferralLocalizationOverrides = { readonly [K in ReferralMessageKey]?: string | Fn<K> };

/**
 * The strings for [locale] (`en` when the kit lacks the language), with [overrides] on top. The result has the same
 * members as the Dart `ReferralKitLocalizations`: `l10n.inviteTitle`, `l10n.skippedCap(2)`.
 *
 * For a language the kit lacks, give every key in [overrides]: plurals then follow that language's rules.
 */
export function referralLocalizations(
  locale: string = 'en',
  overrides: ReferralLocalizationOverrides = {},
): ReferralKitLocalizations {
  const shipped = resolveReferralLocale(locale);
  const hasOverrides = Object.keys(overrides).length > 0;
  const localeName = shipped ?? (hasOverrides ? (locale.split(/[-_]/)[0] ?? 'en').toLowerCase() : 'en');
  const messages = { ...referralMessagesEn, ...(shipped ? referralMessages[shipped] : {}) };
  const out: Record<string, unknown> = { localeName };
  for (const key of Object.keys(referralMessageParams) as ReferralMessageKey[]) {
    const names = referralMessageParams[key];
    const o = overrides[key];
    if (typeof o === 'function') {
      out[key] = o;
      continue;
    }
    const message = typeof o === 'string' ? o : messages[key];
    if (names.length === 0) {
      out[key] = formatIcu(message, {}, localeName);
    } else {
      out[key] = (...args: unknown[]) => {
        const named: Record<string, unknown> = {};
        names.forEach((n, i) => (named[n] = args[i]));
        return formatIcu(message, named, localeName);
      };
    }
  }
  return Object.freeze(out) as unknown as ReferralKitLocalizations;
}

/** Short alias of [referralLocalizations]: `t('hi').inviteTitle`. */
export const t = referralLocalizations;
