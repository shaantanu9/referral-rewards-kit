/**
 * @myind/referral-core: the framework-agnostic core of referral-kit (port of the Flutter `referral_kit` package
 * without its widgets): RPC client, models, invite-code format, localised copy (en, hi, id), analytics events,
 * offline claim queue, prompt policy, install id and referrer, share text, attribution.
 */
export * from './attribution';
export * from './availability';
export * from './client';
export * from './code-format';
export * from './copy';
export * from './event-memory';
export * from './events';
export * from './http-rpc';
export * from './install-id';
export * from './install-referrer';
export * from './l10n';
export * from './launcher';
export * from './models';
export * from './paste';
export * from './pending-claim';
export * from './prompt-policy';
export * from './sha256';
export * from './share';
export * from './storage';
export * from './texts';
export { parseDateTime, type JsonMap } from './json';
