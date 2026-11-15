// Tiny DOM helpers. Text always goes in as text (never innerHTML): handles, links and quiz prompts come from users.
import { bars, reasonText } from "./lib.js";

/** h("div", {class: "x", onclick: f}, "text", child…) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(target, ...nodes) {
  target.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
}

/** A table from rows and [header, cell(row)] columns. */
export function table(rows, columns, empty = "Nothing here.") {
  if (!rows?.length) return h("p", { class: "muted" }, empty);
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, columns.map(([head]) => h("th", {}, head)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, columns.map(([, cell]) => h("td", {}, cell(r)))))),
    ),
  );
}

/** A simple SVG bar chart with an accessible summary. */
export function barChart(values, labels, { title, height = 120 } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 600 ${height}`);
  svg.setAttribute("class", "chart");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${title ?? "Chart"}: ${values.length} values, highest ${Math.max(0, ...values)}`);
  bars(values, { width: 600, height }).forEach((b, i) => {
    const r = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 })) {
      r.setAttribute(k, String(v));
    }
    const t = document.createElementNS(ns, "title");
    t.textContent = `${labels?.[i] ?? i}: ${values[i]}`;
    r.append(t);
    svg.append(r);
  });
  return svg;
}

let toastTimer;
export function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 3500);
}

/** Runs an action, shows the server's reason on failure; returns the result or undefined. */
export async function act(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage);
    return r;
  } catch (e) {
    toast(reasonText(e), "err");
    return undefined;
  }
}

export const loading = () => h("p", { class: "muted" }, "Loading…");

/** Download a JSON value as a file. */
export function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
