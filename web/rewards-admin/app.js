// Rewards admin page: project → sign in (email code) → sections. #demo runs on an in-memory backend.
import { createBackend, keyProblem, savedProject, saveProject } from "./api.js";
import { act, h, mount, toast } from "./dom.js";
import { reasonText } from "./lib.js";
import { renderOverview } from "./view_overview.js";
import { renderPrograms } from "./view_programs.js";
import { renderInstagram, renderLog, renderProblems, renderUsers } from "./view_ops.js";
import { renderQuiz } from "./view_quiz.js";
import { renderCopySetup, renderSettings } from "./view_setup.js";
import { renderFollowups, renderRetention } from "./view_followups.js";
import { renderLeagues } from "./view_leagues.js";
import { renderReferrals } from "./view_referrals.js";

const SECTIONS = [
  ["overview", "Overview", renderOverview],
  ["referrals", "Referrals", renderReferrals],
  ["programs", "Programs", renderPrograms],
  ["quiz", "Quiz bank", renderQuiz],
  ["leagues", "Leagues", renderLeagues],
  ["followups", "Follow-ups", renderFollowups],
  ["retention", "Retention", renderRetention],
  ["users", "Users", renderUsers],
  ["instagram", "Instagram", renderInstagram],
  ["problems", "Problems", renderProblems],
  ["settings", "Settings", renderSettings],
  ["copy", "Copy setup", renderCopySetup],
  ["log", "Audit log", renderLog],
];

// Optional extra sections (view_premium.js): added when the file is present, skipped in a copy without it.
const extraSections = await import("./view_premium.js").then((m) => m.PREMIUM_SECTIONS).catch(() => []);
SECTIONS.splice(SECTIONS.length - 1, 0, ...extraSections);

const root = document.getElementById("app");
const demo = new URLSearchParams(location.search).has("demo") || location.hash.startsWith("#demo");

async function start() {
  const project = savedProject();
  if (!demo && !project) return projectScreen();
  let api;
  try {
    api = await createBackend({ demo, url: project?.url, key: project?.key });
  } catch (e) {
    toast(reasonText(e), "err");
    return projectScreen();
  }
  const session = await api.session();
  if (!session) return signInScreen(api);
  // One call proves the account is an admin before showing anything.
  try {
    await api.rpc("rewards_admin_log", { max_rows: 1 });
  } catch (e) {
    return mount(
      root,
      h(
        "main",
        { class: "narrow" },
        h("h1", {}, "Rewards admin"),
        h("p", { class: "warn-text" }, reasonText(e)),
        h("button", {
          onclick: async () => {
            await api.signOut();
            start();
          },
        }, "Sign out"),
      ),
    );
  }
  shell(api, session);
}

function projectScreen() {
  const url = h("input", { type: "url", placeholder: "https://<ref>.supabase.co", required: true });
  const key = h("input", { placeholder: "anon / publishable key", required: true });
  const msg = h("p", { class: "warn-text" });
  const go = () => {
    const problem = !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url.value.trim()) &&
        !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url.value.trim())
      ? "The project URL looks like https://<ref>.supabase.co"
      : keyProblem(key.value);
    if (problem) return (msg.textContent = problem);
    saveProject({ url: url.value.trim().replace(/\/$/, ""), key: key.value.trim() });
    start();
  };
  mount(
    root,
    h(
      "main",
      { class: "narrow" },
      h("h1", {}, "Rewards admin"),
      h(
        "p",
        { class: "muted" },
        "Your Supabase project's URL and public key (Settings → API). Never the service-role key: you sign in as yourself, and only accounts listed as rewards admins get in.",
      ),
      h("label", {}, "Project URL", url),
      h("label", {}, "Public key", key),
      msg,
      h("button", { class: "primary", onclick: go }, "Continue"),
      h(
        "p",
        { class: "muted" },
        "Just looking? ",
        h("a", { href: "?demo" }, "Open the demo"),
        " (fake data in this tab only).",
      ),
    ),
  );
}

function signInScreen(api) {
  const email = h("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
  const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", placeholder: "Code from the email" });
  const step2 = h(
    "div",
    { hidden: true },
    h("label", {}, "Code", code),
    h("button", {
      class: "primary",
      onclick: async () => {
        if (await act(() => api.verifyCode(email.value.trim(), code.value.trim()).then(() => true))) start();
      },
    }, "Sign in"),
  );
  mount(
    root,
    h(
      "main",
      { class: "narrow" },
      h("h1", {}, "Sign in"),
      h("p", { class: "muted" }, "Use the email of an account listed in rewards.admins. We send a code; no password."),
      h("label", {}, "Email", email),
      h("button", {
        onclick: async () => {
          if (await act(() => api.sendCode(email.value.trim()).then(() => true), "Code sent")) step2.hidden = false;
        },
      }, "Send code"),
      step2,
      h(
        "p",
        {},
        h("button", {
          class: "link",
          onclick: () => {
            saveProject(null);
            start();
          },
        }, "Use another project"),
      ),
    ),
  );
}

function shell(api, session) {
  const content = h("div", { id: "content" });
  const nav = h(
    "nav",
    {},
    SECTIONS.map(([id, label]) => h("a", { href: `#${demo ? "demo/" : ""}${id}`, "data-id": id }, label)),
  );
  mount(
    root,
    h(
      "header",
      {},
      h("strong", {}, "Rewards admin"),
      api.demo ? h("span", { class: "chip warn" }, "Demo: fake data") : null,
      h("span", { class: "grow" }),
      h("span", { class: "muted" }, session.email ?? ""),
      api.demo ? null : h("button", {
        class: "link",
        onclick: async () => {
          await api.signOut();
          start();
        },
      }, "Sign out"),
    ),
    h("div", { class: "layout" }, nav, h("main", {}, content)),
  );
  const route = () => {
    const id = location.hash.replace(/^#(demo\/?)?/, "") || "overview";
    const section = SECTIONS.find(([s]) => s === id) ?? SECTIONS[0];
    for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.dataset.id === section[0]);
    document.title = `${section[1]} · Rewards admin`;
    section[2](content, api);
  };
  globalThis.onhashchange = route;
  route();
}

start();
