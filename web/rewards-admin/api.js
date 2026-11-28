// Backend for the admin page: the project's admin RPCs through supabase-js (live), or the in-memory demo (#demo).
// Only the project URL and its public (anon / publishable) key are ever entered here; access comes from the admin's
// own sign-in, and every rewards_admin_* function checks rewards.admins itself.

import { createDemoBackend } from "./demo.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const STORE = "rewards-admin.project";

export function savedProject() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return p && typeof p.url === "string" && typeof p.key === "string" ? p : null;
  } catch {
    return null;
  }
}

export function saveProject(p) {
  try {
    if (p) localStorage.setItem(STORE, JSON.stringify(p));
    else localStorage.removeItem(STORE);
  } catch { /* private mode: the page still works for this visit */ }
}

/** Refuses a service-role key: it would bypass every check and must never sit in a browser. */
export function keyProblem(key) {
  const k = String(key ?? "").trim();
  if (!k) return "Paste the project's anon / publishable key.";
  if (k.startsWith("sb_secret_")) return "That is a secret key. Use the anon / publishable key.";
  try {
    const payload = JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role === "service_role") return "That is the service-role key. Use the anon / publishable key.";
  } catch { /* not a JWT: new-style publishable keys are fine */ }
  return null;
}

export async function createBackend({ demo, url, key }) {
  if (demo) {
    // Optional extra sections ship their own demo functions; a copy without them still runs.
    const extra = await import("./demo_premium.js").then((m) => m.premiumDemoFns).catch(() => null);
    const d = createDemoBackend(extra);
    return {
      demo: true,
      rpc: d.rpc,
      session: () => Promise.resolve({ email: "demo@example.com" }),
      sendCode: () => Promise.resolve(),
      verifyCode: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
    };
  }
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(url, key, { auth: { persistSession: true, storageKey: "rewards-admin.auth" } });
  return {
    demo: false,
    async rpc(fn, params = {}) {
      const { data, error } = await sb.rpc(fn, params);
      if (error) throw new Error(`${error.message}${error.code ? ` (${error.code})` : ""}`);
      return data;
    },
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email, id: data.session.user.id } : null;
    },
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw error;
    },
    async verifyCode(email, token) {
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
    },
    async signOut() {
      await sb.auth.signOut();
    },
  };
}
