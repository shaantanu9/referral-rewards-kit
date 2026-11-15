// Quiz bank: list and edit questions, paste many as CSV, and see which ones players get wrong.
import { act, h, loading, mount, table } from "./dom.js";
import { fmtNum, fmtPct, hardestQuestions, questionsFromCsv } from "./lib.js";

const KINDS = ["choice", "true_false", "odd_one_out", "listen", "picture"];

export async function renderQuiz(el, api) {
  let bank = "default";
  const draw = async () => {
    mount(el, loading());
    const [list, stats] = await Promise.all([
      act(() => api.rpc("rewards_admin_quiz_list", { bank })),
      act(() => api.rpc("rewards_admin_quiz_stats", { bank, days: 30 })),
    ]);
    const bankInput = h("input", { value: bank, size: 12 });
    mount(
      el,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Quiz bank"),
        h(
          "div",
          { class: "form-row" },
          h("label", {}, "Bank", bankInput),
          h("button", {
            onclick: () => {
              bank = bankInput.value.trim() || "default";
              draw();
            },
          }, "Open"),
        ),
      ),
      h(
        "p",
        { class: "muted" },
        "The answer never reaches the app. A quiz program picks its daily questions from its bank.",
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, `Questions (${(list ?? []).length})`),
        table(list, [
          ["Kind", (q) => q.kind],
          ["Question", (q) => q.prompt],
          ["Choices", (q) => q.choices.map((c, i) => (i === q.answer ? `✓ ${c}` : c)).join(" · ")],
          ["Seconds", (q) => q.time_limit_s],
          ["", (q) => [
            h("button", { onclick: () => edit(q) }, "Edit"),
            " ",
            h("button", { onclick: () => toggle(q) }, q.active ? "Hide" : "Use"),
          ]],
        ], "No questions in this bank yet."),
      ),
      editor(),
      csvCard(),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Hardest questions (last 30 days, answered 5+ times)"),
        table(hardestQuestions(stats), [["Question", (s) => s.prompt], ["Answered", (s) => fmtNum(s.answered)], [
          "Right",
          (s) => fmtPct(s.correct_rate),
        ], ["Ran out of time", (s) => fmtNum(s.timed_out)]], "Not enough answers yet."),
      ),
    );
  };

  const save = async (questions, msg) => {
    if (await act(() => api.rpc("rewards_admin_quiz_save", { bank, questions }), msg)) draw();
  };
  const toggle = (q) => save([{ ...q, active: !q.active }], q.active ? "Hidden" : "In use");

  let editing = null;
  const form = {
    kind: h("select", {}, KINDS.map((k) => h("option", { value: k }, k))),
    prompt: h("textarea", { rows: 2 }),
    choices: h("textarea", { rows: 3, placeholder: "One choice per line" }),
    answer: h("input", { type: "number", min: "1", value: "1" }),
    seconds: h("input", { type: "number", min: "3", max: "120", value: "15" }),
    media: h("input", { placeholder: 'listen: {"sound_id":"boom_1"} · picture: {"image_url":"https://…"}' }),
    explanation: h("input", { placeholder: "Shown after answering (optional)" }),
  };
  const edit = (q) => {
    editing = q;
    form.kind.value = q.kind;
    form.prompt.value = q.prompt;
    form.choices.value = q.choices.join("\n");
    form.answer.value = String(q.answer + 1);
    form.seconds.value = String(q.time_limit_s);
    form.media.value = JSON.stringify(q.media ?? {});
    form.explanation.value = q.explanation ?? "";
    form.prompt.focus();
  };
  const submit = () => {
    let media = {};
    try {
      media = form.media.value.trim() ? JSON.parse(form.media.value) : {};
    } catch {
      return form.media.reportValidity();
    }
    const q = {
      kind: form.kind.value,
      prompt: form.prompt.value.trim(),
      choices: form.choices.value.split("\n").map((c) => c.trim()).filter(Boolean),
      answer: Number(form.answer.value) - 1,
      time_limit_s: Number(form.seconds.value),
      media,
      explanation: form.explanation.value.trim() || null,
    };
    if (editing) q.id = editing.id;
    editing = null;
    save([q], "Question saved");
  };
  const editor = () =>
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Add or edit a question"),
      h(
        "div",
        { class: "form-row" },
        h("label", {}, "Kind", form.kind),
        h("label", {}, "Right answer (number)", form.answer),
        h("label", {}, "Seconds", form.seconds),
      ),
      h("label", {}, "Question", form.prompt),
      h("label", {}, "Choices", form.choices),
      h("label", {}, "Media (JSON)", form.media),
      h("label", {}, "Explanation", form.explanation),
      h("button", { class: "primary", onclick: submit }, "Save question"),
    );

  const csvCard = () => {
    const text = h("textarea", {
      rows: 5,
      spellcheck: "false",
      placeholder: "kind,prompt,choices,answer,seconds,explanation\nchoice,Who reads the narrator?,Mia|Leo|Ava,1,15,",
    });
    const out = h("div");
    const go = () => {
      const { questions, errors } = questionsFromCsv(text.value);
      if (errors.length) return mount(out, h("ul", { class: "warn-text" }, errors.map((e) => h("li", {}, e))));
      if (!questions.length) return mount(out, h("p", { class: "muted" }, "Nothing to add."));
      save(questions, `${questions.length} questions added`);
    };
    return h(
      "section",
      { class: "card" },
      h("h3", {}, "Paste many (CSV)"),
      h(
        "p",
        { class: "muted" },
        "Columns: kind, prompt, choices separated by |, the right answer's number (1 = first), seconds, explanation.",
      ),
      text,
      h("button", { onclick: go }, "Check and add"),
      out,
    );
  };

  await draw();
}
