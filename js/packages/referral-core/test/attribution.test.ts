// The attribution link (ADR 0003). The expected outputs live in js/test-fixtures/attribution-links.json, shared with
// rewards-core's test, so both packages are held to the same links.
import { expect, it } from 'vitest';
import {
  attributionLink,
  attributionVariantIndex,
  badgeUrl,
  githubUrl,
  MYIND_ATTRIBUTION,
  proUrl,
  showcaseUrl,
  withAttributionUtm,
} from '../src';
import fixture from '../../../test-fixtures/attribution-links.json';

const expectedLinks = fixture.links;

it('four variants with their text, URL, UTM tags and label', () => {
  expect([0, 1, 2, 3].map((v) => attributionLink(v, 'acme'))).toEqual(expectedLinks);
});

it('the index wraps modulo the variants, also negative and fractional', () => {
  expect(attributionLink(4, 'acme')).toEqual(expectedLinks[0]);
  expect(attributionLink(7, 'acme')).toEqual(expectedLinks[3]);
  expect(attributionLink(-1, 'acme')).toEqual(expectedLinks[3]);
  expect(attributionVariantIndex(2.9)).toBe(2);
  expect(attributionVariantIndex(Number.NaN)).toBe(0);
});

it('the source is encoded; an existing query and fragment are kept, old UTM tags replaced', () => {
  expect(attributionLink(0, 'com.acme app').url).toContain('utm_source=com.acme%20app&');
  expect(withAttributionUtm('https://x.test/p?ref=1&utm_source=old#top', 's', 1)).toBe(
    'https://x.test/p?ref=1&utm_source=s&utm_medium=attribution&utm_campaign=v1#top',
  );
});

it('site URLs', () => {
  expect(showcaseUrl).toBe('https://www.myind.ai/referral-kit/showcase');
  expect(proUrl).toBe('https://www.myind.ai/referral-kit/pro');
  expect(badgeUrl).toBe('https://www.myind.ai/referral-kit/badge.svg');
  expect(githubUrl).toBe('https://github.com/shaantanu9/referral-rewards-kit');
  expect(MYIND_ATTRIBUTION.variants).toHaveLength(4);
});
