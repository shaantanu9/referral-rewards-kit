// deno test for the RevenueCat API v2 client's subscription reads, against a scripted fetch. No network.
import assert from "./test_assert.ts";
import { fetchRevenueCat, RevenueCatError } from "./revenuecat.ts";

function scripted(pages: Record<string, unknown>) {
  const urls: string[] = [];
  const f = ((input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const path = url.replace("https://api.revenuecat.com/v2", "");
    const body = pages[path];
    return Promise.resolve(
      body === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 }),
    );
  }) as typeof fetch;
  return { f, urls };
}

const BASE = "/projects/proj_test/subscriptions/sub_1";

Deno.test("revenuecat: getSubscription reads GET /projects/{p}/subscriptions/{id}", async () => {
  const { f, urls } = scripted({ [BASE]: { id: "sub_1", entitlements: { items: [], next_page: null } } });
  const rc = fetchRevenueCat({ secretKey: "test-key-not-real", projectId: "proj_test", fetch: f });
  assert.equal((await rc.getSubscription("sub_1")).id, "sub_1");
  assert.deepEqual(urls, [`https://api.revenuecat.com/v2${BASE}`]);
});

Deno.test("revenuecat: listSubscriptionEntitlements follows next_page (starting_after) to the end", async () => {
  const { f, urls } = scripted({
    [`${BASE}/entitlements?limit=100`]: {
      items: [{ id: "entl_a", lookup_key: "a" }],
      next_page: `/v2${BASE}/entitlements?starting_after=entl_a`,
    },
    [`${BASE}/entitlements?limit=100&starting_after=entl_a`]: {
      items: [{ id: "entl_b", lookup_key: "b" }],
      next_page: null,
    },
  });
  const rc = fetchRevenueCat({ secretKey: "test-key-not-real", projectId: "proj_test", fetch: f });
  assert.deepEqual((await rc.listSubscriptionEntitlements("sub_1")).map((e) => e.lookup_key), ["a", "b"]);
  assert.equal(urls.length, 2);
});

Deno.test("revenuecat: listSubscriptionEntitlements stops at the page cap with a retryable error", async () => {
  let n = 0;
  const f = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ items: [{ id: `e${n}` }], next_page: `/v2${BASE}/entitlements?starting_after=e${n++}` }),
        { status: 200 },
      ),
    )) as typeof fetch;
  const rc = fetchRevenueCat({ secretKey: "test-key-not-real", projectId: "proj_test", fetch: f, maxPages: 3 });
  const e = await rc.listSubscriptionEntitlements("sub_1").then(() => null, (x) => x);
  assert.ok(e instanceof RevenueCatError && e.kind === "server", "too many pages → server (retry)");
  assert.equal(n, 3);
});
