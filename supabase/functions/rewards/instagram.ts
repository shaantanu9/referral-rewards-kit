// Instagram mentions webhook (ADR 0002 section 6.3, 10.2): signature check, payload parsing, Graph API lookups.
// Every payload shape and Graph API path here is [unconfirmed] until a live test against a real Instagram
// professional account. Never logs tokens, captions or usernames.

import { safeEqual } from "../referral/index.ts";

/** Most items handled per webhook request; the rest are logged as dropped (Meta batches are small in practice). */
export const MAX_ITEMS = 50;

/** One mention to verify. */
export type MentionItem =
  /** `changes[].field == "mentions"`: a caption mention (media only) or a comment mention (with comment_id). */
  | { kind: "media"; media_id: string; comment_id: string | null }
  /** `messaging[].message.attachments[].type == "story_mention"`. */
  | { kind: "story"; sender_id: string; message_id: string | null; url: string | null };

/** `sha256=` + hex HMAC-SHA256 of the raw body with the app secret, compared in constant time. */
export async function verifyHubSignature(raw: Uint8Array, header: string | null, secret: string): Promise<boolean> {
  if (header === null || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw as Uint8Array<ArrayBuffer>));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return await safeEqual(header.slice("sha256=".length).toLowerCase(), hex);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Graph ids arrive as strings; accept numbers too. Only digits/letters/_/- so an id is never a path. */
function id(v: unknown): string | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  return typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null;
}

/**
 * Mentions in a webhook body [unconfirmed shapes]:
 *   {"object":"instagram","entry":[{"id":"…","changes":[{"field":"mentions","value":{"media_id":"…","comment_id":"…"}}]}]}
 *   {"object":"instagram","entry":[{"id":"…","messaging":[{"sender":{"id":"…"},"message":{"mid":"…",
 *     "attachments":[{"type":"story_mention","payload":{"url":"…"}}]}}]}]}
 * Malformed parts are skipped, never thrown. Returns at most `max` items and the count dropped beyond it.
 */
export function parseMentions(body: unknown, max = MAX_ITEMS): { items: MentionItem[]; dropped: number } {
  const items: MentionItem[] = [];
  let dropped = 0;
  const push = (m: MentionItem) => (items.length < max ? items.push(m) : dropped++);
  if (!isObj(body)) return { items, dropped };
  for (const entry of arr(body.entry)) {
    if (!isObj(entry)) continue;
    for (const ch of arr(entry.changes)) {
      if (!isObj(ch) || ch.field !== "mentions" || !isObj(ch.value)) continue;
      const media = id(ch.value.media_id);
      if (media === null) continue;
      push({ kind: "media", media_id: media, comment_id: id(ch.value.comment_id) });
    }
    for (const m of arr(entry.messaging)) {
      if (!isObj(m) || !isObj(m.message) || !isObj(m.sender)) continue;
      const sender = id(m.sender.id);
      if (sender === null) continue;
      const mid = typeof m.message.mid === "string" && m.message.mid.length <= 512 ? m.message.mid : null;
      for (const a of arr(m.message.attachments)) {
        if (!isObj(a) || a.type !== "story_mention") continue;
        const url = isObj(a.payload) && typeof a.payload.url === "string" ? a.payload.url : null;
        push({ kind: "story", sender_id: sender, message_id: mid, url });
      }
    }
  }
  return { items, dropped };
}

export class GraphApiError extends Error {
  constructor(readonly op: string, readonly status: number | null) {
    super(`graph ${op}: ${status === null ? "network/timeout" : `HTTP ${status}`}`);
    this.name = "GraphApiError";
  }
}

/** The lookups the webhook needs. Each returns null fields when Meta leaves them out. */
export interface GraphApi {
  /** Caption mention: who posted the media and its caption. */
  media(mediaId: string): Promise<{ username: string | null; caption: string | null }>;
  /** Comment mention: who wrote the comment and its text. */
  comment(commentId: string): Promise<{ username: string | null; text: string | null }>;
  /** Story mention: the sender's username from their Instagram-scoped id. */
  user(igsid: string): Promise<{ username: string | null }>;
}

export interface FetchGraphApiOptions {
  accessToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Graph API v21.0 [unconfirmed paths]: GET /{media_id}?fields=username,caption, /{comment_id}?fields=username,text,
 * /{igsid}?fields=username. Meta's documented route for media that mention you may instead be
 * /{ig-user-id}?fields=mentioned_media.media_id({media_id}){username,caption}; check at the first live test.
 * The token goes in the Authorization header, never in the URL, and errors carry only the status.
 */
export function fetchGraphApi(opts: FetchGraphApiOptions): GraphApi {
  const base = (opts.baseUrl ?? "https://graph.facebook.com/v21.0").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  async function get(op: string, node: string, fields: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(`${base}/${encodeURIComponent(node)}?fields=${fields}`, {
        headers: { "Authorization": `Bearer ${opts.accessToken}`, "Accept": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GraphApiError(op, null);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new GraphApiError(op, res.status);
    }
    try {
      const j = await res.json();
      return isObj(j) ? j : {};
    } catch {
      throw new GraphApiError(op, res.status);
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    media: async (m) => {
      const j = await get("media", m, "username,caption");
      return { username: str(j.username), caption: str(j.caption) };
    },
    comment: async (c) => {
      const j = await get("comment", c, "username,text");
      return { username: str(j.username), text: str(j.text) };
    },
    user: async (u) => ({ username: str((await get("user", u, "username")).username) }),
  };
}

/** Lower case, no leading `@`, Instagram's character set; null when it cannot be a handle. */
export function normaliseUsername(u: string | null): string | null {
  if (u === null) return null;
  const s = u.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

/** What verify_social is called with for one item. */
export interface VerifyArgs {
  platform: "instagram";
  username: string;
  caption: string | null;
  media_id: string | null;
}

/** Resolve one item through the Graph API into verify_social arguments; null when no usable username. */
export async function resolveItem(g: GraphApi, item: MentionItem): Promise<VerifyArgs | null> {
  let username: string | null;
  let caption: string | null;
  let mediaId: string | null;
  if (item.kind === "media" && item.comment_id !== null) {
    const c = await g.comment(item.comment_id);
    [username, caption, mediaId] = [c.username, c.text, item.media_id];
  } else if (item.kind === "media") {
    const m = await g.media(item.media_id);
    [username, caption, mediaId] = [m.username, m.caption, item.media_id];
  } else {
    // A story has no caption we can read; the post matches by handle. The message id stands in for the media id.
    username = (await g.user(item.sender_id)).username;
    [caption, mediaId] = [null, item.message_id];
  }
  const u = normaliseUsername(username);
  return u === null ? null : { platform: "instagram", username: u, caption, media_id: mediaId };
}
