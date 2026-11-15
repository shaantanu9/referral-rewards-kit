// deno test for instagram.ts: signature, payload parsing, username handling and Graph lookups (ADR 0002 6.3, 10.2).
import assert from "../referral/test_assert.ts";
import {
  fetchGraphApi,
  type GraphApi,
  GraphApiError,
  normaliseUsername,
  parseMentions,
  resolveItem,
  verifyHubSignature,
} from "./instagram.ts";

const SECRET = "test-app-secret";

export async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("signature: valid, tampered, wrong secret, missing, wrong prefix", async () => {
  const body = '{"object":"instagram","entry":[]}';
  const sig = await sign(body);
  assert.ok(await verifyHubSignature(enc(body), sig, SECRET), "valid");
  assert.ok(await verifyHubSignature(enc(body), sig.toUpperCase().replace("SHA256=", "sha256="), SECRET), "hex case");
  assert.ok(!(await verifyHubSignature(enc(body + " "), sig, SECRET)), "tampered body");
  assert.ok(!(await verifyHubSignature(enc(body), await sign(body, "other"), SECRET)), "wrong secret");
  assert.ok(!(await verifyHubSignature(enc(body), null, SECRET)), "missing");
  assert.ok(!(await verifyHubSignature(enc(body), sig.replace("sha256=", "sha1="), SECRET)), "wrong prefix");
});

Deno.test("parse: caption mention, comment mention and story mention", () => {
  const { items, dropped } = parseMentions({
    object: "instagram",
    entry: [{
      id: "1",
      changes: [
        { field: "mentions", value: { media_id: "17900" } },
        { field: "mentions", value: { media_id: "17901", comment_id: "17999" } },
        { field: "comments", value: { media_id: "x" } },
      ],
      messaging: [{
        sender: { id: "5550" },
        message: { mid: "m-1", attachments: [{ type: "story_mention", payload: { url: "https://cdn/x" } }] },
      }],
    }],
  });
  assert.equal(dropped, 0);
  assert.deepEqual(items, [
    { kind: "media", media_id: "17900", comment_id: null },
    { kind: "media", media_id: "17901", comment_id: "17999" },
    { kind: "story", sender_id: "5550", message_id: "m-1", url: "https://cdn/x" },
  ]);
});

Deno.test("parse: malformed parts are skipped, never thrown", () => {
  for (
    const body of [null, 1, "x", [], { entry: "x" }, { entry: [null, 1, { changes: [null, { field: "mentions" }] }] }]
  ) {
    assert.deepEqual(parseMentions(body), { items: [], dropped: 0 });
  }
  const bad = parseMentions({ entry: [{ changes: [{ field: "mentions", value: { media_id: "../etc/passwd" } }] }] });
  assert.equal(bad.items.length, 0, "an id that could be a path is refused");
  const noSender = parseMentions({
    entry: [{ messaging: [{ message: { attachments: [{ type: "story_mention" }] } }] }],
  });
  assert.equal(noSender.items.length, 0);
});

Deno.test("parse: numeric ids accepted, items capped with a dropped count", () => {
  const changes = Array.from({ length: 5 }, (_, i) => ({ field: "mentions", value: { media_id: 100 + i } }));
  const r = parseMentions({ entry: [{ changes }] }, 3);
  assert.equal(r.items.length, 3);
  assert.equal(r.dropped, 2);
  assert.deepEqual(r.items[0], { kind: "media", media_id: "100", comment_id: null });
});

Deno.test("normaliseUsername", () => {
  assert.equal(normaliseUsername("@Reader.One "), "reader.one");
  assert.equal(normaliseUsername("bad name"), null);
  assert.equal(normaliseUsername(null), null);
  assert.equal(normaliseUsername("a".repeat(31)), null);
});

const graph = (over: Partial<GraphApi> = {}): GraphApi => ({
  media: () => Promise.resolve({ username: "Reader.One", caption: "love it MYAPP-K7Q2HX" }),
  comment: () => Promise.resolve({ username: "commenter", text: "@myapp MYAPP-ABCDEF" }),
  user: () => Promise.resolve({ username: "storyteller" }),
  ...over,
});

Deno.test("resolveItem: media, comment and story", async () => {
  assert.deepEqual(await resolveItem(graph(), { kind: "media", media_id: "1", comment_id: null }), {
    platform: "instagram",
    username: "reader.one",
    caption: "love it MYAPP-K7Q2HX",
    media_id: "1",
  });
  assert.deepEqual(await resolveItem(graph(), { kind: "media", media_id: "1", comment_id: "2" }), {
    platform: "instagram",
    username: "commenter",
    caption: "@myapp MYAPP-ABCDEF",
    media_id: "1",
  });
  assert.deepEqual(await resolveItem(graph(), { kind: "story", sender_id: "9", message_id: "m-1", url: null }), {
    platform: "instagram",
    username: "storyteller",
    caption: null,
    media_id: "m-1",
  });
});

Deno.test("resolveItem: no usable username → null", async () => {
  const g = graph({ media: () => Promise.resolve({ username: null, caption: "x" }) });
  assert.equal(await resolveItem(g, { kind: "media", media_id: "1", comment_id: null }), null);
});

Deno.test("fetchGraphApi: token in the header, not the URL; errors carry only the status", async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const fake = (status: number, body: unknown) => (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const g = fetchGraphApi({ accessToken: "tok-secret", fetch: fake(200, { username: "u1", caption: "c" }) });
  assert.deepEqual(await g.media("123"), { username: "u1", caption: "c" });
  assert.ok(!seen[0].url.includes("tok-secret"), "token not in URL");
  assert.equal(seen[0].auth, "Bearer tok-secret");
  assert.ok(seen[0].url.endsWith("/123?fields=username,caption"));

  const bad = fetchGraphApi({ accessToken: "tok-secret", fetch: fake(400, { error: "tok-secret leaked?" }) });
  try {
    await bad.user("9");
    throw new Error("no error");
  } catch (e) {
    assert.ok(e instanceof GraphApiError);
    assert.equal((e as GraphApiError).status, 400);
    assert.ok(!(e as Error).message.includes("tok-secret"));
  }
});
