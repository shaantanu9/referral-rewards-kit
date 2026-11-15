// Follow-up emails (ADR 0002 18.7): claim from the database, send through Resend, record each result; and the
// one-click unsubscribe page. Dry run unless REWARDS_EMAIL_DRY_RUN is exactly "false". Never logs addresses.

import type { Db } from "./db.ts";

export interface ClaimedEmail {
  send_id: string | null;
  program: string;
  user_id: string;
  email: string;
  name: string | null;
  subject: string;
  heading: string | null;
  body: string;
  button: string;
  url: string;
  unsubscribe_token: string;
  /** The app's branded layout (rewards_admin_email_template_save), or null for the built-in one. */
  template_html?: string | null;
}

export interface Mailer {
  /** Sends one email; returns the provider's id. Throws on failure. */
  send(
    m: { to: string; subject: string; html: string; text: string; headers: Record<string, string> },
  ): Promise<string>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain, accessible HTML: heading, the body's paragraphs, one button, the unsubscribe line. */
export function renderEmail(
  m: ClaimedEmail,
  o: { appName: string; unsubscribeUrl: string },
): { html: string; text: string } {
  const paras = m.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const text = [m.heading, ...paras, `${m.button}: ${m.url}`, `Stop these emails: ${o.unsubscribeUrl}`]
    .filter(Boolean).join("\n\n");
  if (m.template_html) return { html: fillTemplate(m.template_html, m, o, paras), text };
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#16181d">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
${m.heading ? `<h1 style="font-size:20px;margin:0 0 16px">${esc(m.heading)}</h1>` : ""}
${paras.map((p) => `<p style="font-size:16px;line-height:1.5;margin:0 0 14px">${esc(p)}</p>`).join("\n")}
<p style="margin:22px 0"><a href="${
      esc(m.url)
    }" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${
      esc(m.button)
    }</a></p>
<p style="font-size:12px;color:#5d6470;margin:24px 0 0">You get this because you use ${esc(o.appName)}. <a href="${
      esc(o.unsubscribeUrl)
    }" style="color:#5d6470">Stop these emails</a>.</p>
</div></body></html>`;
  return { html, text };
}

/** Fills an app template. Every value is HTML-escaped; {{body}} becomes <p> paragraphs. Unknown {{names}} are left
 * empty so a typo never reaches the reader as a raw placeholder. The template must contain {{unsubscribe_url}} (the
 * database refuses one without it). */
export function fillTemplate(
  tpl: string,
  m: ClaimedEmail,
  o: { appName: string; unsubscribeUrl: string },
  paras = m.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
): string {
  const values: Record<string, string> = {
    subject: esc(m.subject),
    heading: esc(m.heading ?? ""),
    body: paras.map((p) => `<p>${esc(p)}</p>`).join("\n"),
    button: esc(m.button),
    url: esc(m.url),
    name: esc(m.name ?? ""),
    app_name: esc(o.appName),
    unsubscribe_url: esc(o.unsubscribeUrl),
  };
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => values[k] ?? "");
}

export function resendMailer(opts: { apiKey: string; from: string; replyTo?: string; fetch?: typeof fetch }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(m) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: opts.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: m.headers,
          ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`resend HTTP ${res.status}`);
      }
      const j = await res.json().catch(() => ({})) as { id?: string };
      return j.id ?? "";
    },
  };
}

export interface FollowupRun {
  dryRun: boolean;
  claimed: number;
  sent: number;
  failed: number;
  /** In a dry run: program and masked address of each email that would go. */
  preview: { program: string; to: string }[];
}

const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

/** One daily run: claim, send, finish. A send that fails is recorded and may be tried on a later run. */
export async function runFollowups(
  db: Db,
  mailer: Mailer | null,
  o: { dryRun: boolean; appName: string; publicUrl: string; max?: number },
): Promise<FollowupRun> {
  const claimed = await db.rpc<ClaimedEmail[] | null>("rewards_svc_followup_claim", {
    dry_run: o.dryRun,
    max_rows: o.max ?? 200,
  }) ?? [];
  const out: FollowupRun = { dryRun: o.dryRun, claimed: claimed.length, sent: 0, failed: 0, preview: [] };
  for (const m of claimed) {
    if (o.dryRun || mailer === null || m.send_id === null) {
      out.preview.push({ program: m.program, to: mask(m.email) });
      continue;
    }
    const unsubscribeUrl = `${o.publicUrl.replace(/\/+$/, "")}/unsubscribe?t=${
      encodeURIComponent(m.unsubscribe_token)
    }`;
    const { html, text } = renderEmail(m, { appName: o.appName, unsubscribeUrl });
    try {
      const id = await mailer.send({
        to: m.email,
        subject: m.subject,
        html,
        text,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await db.rpc("rewards_svc_followup_finish", { send_id: m.send_id, ok: true, provider_id: id, error: null });
      out.sent++;
    } catch (e) {
      await db.rpc("rewards_svc_followup_finish", {
        send_id: m.send_id,
        ok: false,
        provider_id: null,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
      out.failed++;
    }
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The unsubscribe page: GET shows a button (mail scanners must not unsubscribe by opening the link); POST does it. */
export async function unsubscribe(req: Request, db: Db, appName: string): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const page = (title: string, body: string, status = 200) =>
    new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${
        esc(title)
      }</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#16181d"><h1 style="font-size:22px">${
        esc(title)
      }</h1>${body}</body></html>`,
      { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  if (!UUID.test(token)) return page("Link not valid", "<p>This unsubscribe link is not complete.</p>", 400);
  if (req.method === "GET") {
    return page(
      `Stop ${appName} emails?`,
      `<p>You will still get sign-in codes. You can turn these emails back on in the app's settings.</p><form method="post"><button style="padding:10px 18px;font-size:16px;border-radius:8px;border:1px solid #0f766e;background:#0f766e;color:#fff">Stop these emails</button></form>`,
    );
  }
  const r = await db.rpc<{ ok?: boolean } | null>("rewards_svc_followup_unsubscribe", { token });
  return r?.ok
    ? page("Done", `<p>You will not get these ${esc(appName)} emails again.</p>`)
    : page("Link not valid", "<p>This link is no longer valid. You may already be unsubscribed.</p>", 404);
}
