import { expect, test } from "bun:test";
import { autoChoice, parseScreen } from "./menu";

test("Claude AskUserQuestion menu", () => {
  const tail = [
    "❯ This is a UI test.",
    "─────────────────────────────",
    " ☐ Color",
    "Which color do you prefer?",
    "❯ 1. Red",
    "     The color red",
    "  2. Green",
    "     The color green",
    "  3. Blue",
    "     The color blue",
    "  4. Type something.",
    "─────────────────────────────",
    "  5. Chat about this",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ];
  const v = parseScreen(tail);
  expect(v.options.map((o) => o.label)).toEqual(["Red", "Green", "Blue", "Type something.", "Chat about this"]);
  expect(v.options[0].selected).toBe(true);
  expect(v.options[3].freeText).toBe(true);
  expect(v.options[4].freeText).toBe(false);
  expect(v.lines).toContain("Which color do you prefer?");
  expect(v.lines.some((l) => l.includes("Enter to select"))).toBe(false);
});

test("boxed Claude permission prompt", () => {
  const tail = [
    "╭──────────────────────────────╮",
    "│ Bash command                  │",
    "│   rm -rf build                │",
    "│ Do you want to proceed?       │",
    "│ ❯ 1. Yes                      │",
    "│   2. Yes, and don't ask again │",
    "│   3. No, and tell Claude what to do differently (esc) │",
    "╰──────────────────────────────╯",
  ];
  const v = parseScreen(tail);
  expect(v.options.map((o) => o.n)).toEqual([1, 2, 3]);
  expect(v.options[2].freeText).toBe(true);
  expect(v.lines).toContain("  rm -rf build");
});

test("Codex approval", () => {
  const tail = ["  Would you like to run the following command?", "  $ pnpm test", "› 1. Yes, proceed (y)", "  2. Yes, and don't ask again for this command (p)", "  3. No, and tell Codex what to do differently (esc)"];
  const v = parseScreen(tail);
  expect(v.options.length).toBe(3);
  expect(v.options[0].selected).toBe(true);
});

test("no menu: plain tail", () => {
  const v = parseScreen(["⏺ Green", "✻ Baked for 13s", "❯"]);
  expect(v.options).toEqual([]);
  expect(v.lines).toContain("⏺ Green");
});

test("numbered prose list that does not start at 1 is not a menu", () => {
  const v = parseScreen(["Steps:", "  3. run", "  4. ship"]);
  expect(v.options).toEqual([]);
});

// A real screen (Claude Code 2.1.319): a message from another session held for approval.
const HELD = [
  "⏺ Held peer message — from uds:/tmp/cc-socks/22646.sock [verified pid 22646] (peer claims name: mukhayyar-b4); preview: «Floe test 2: checking how the",
  "  held-message approval dialog renders. No action needed.» — not delivered to Claude (1 held). The sending session's permission mode class doesn't",
  "  match this session's. Review it below, or set \"crossSessionInbound\" to \"accept\".",
  "───────────────────────────────────────────────────────────────────────────",
  " Held message from another session",
  " Another Claude session sent a message: from uds:/tmp/cc-socks/22646.sock [verified pid 22646] (peer claims name: mukhayyar-b4)",
  " The sending session's permission mode class doesn't match this session's, so it wasn't delivered automatically.",
  " Message body (this is what will be delivered):",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  " │ Floe test 2: checking how the held-message approval dialog renders. No a",
  " │ …[1 line, 85 chars total — full body will be delivered on approve]",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  " ❯ Deny — drop it and tell the sender it was declined",
  "   Deliver this message to Claude",
];

test("held cross-session message: a menu without numbers", () => {
  const v = parseScreen(HELD, { unnumbered: true });
  expect(v.numbered).toBe(false);
  expect(v.options.map((o) => o.label)).toEqual(["Deny — drop it and tell the sender it was declined", "Deliver this message to Claude"]);
  expect(v.options.map((o) => o.selected)).toEqual([true, false]);
  expect(v.options.map((o) => o.n)).toEqual([1, 2]);
  expect(v.lines[0]).toBe(" Held message from another session");
  expect(v.lines).toContain("Floe test 2: checking how the held-message approval dialog renders. No a");
  expect(v.lines.some((l) => l.includes("╌"))).toBe(false);
});

test("unnumbered menus are only read when the agent is blocked on a prompt", () => {
  expect(parseScreen(HELD).options).toEqual([]);
});

test("Claude's prompt box is not an unnumbered menu", () => {
  const rule = "─".repeat(60);
  const box = ["⏺ Done.", rule, "❯ fix the login page", "  and add a test for it", rule, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"];
  expect(parseScreen(box, { unnumbered: true }).options).toEqual([]);
  expect(parseScreen(["⏺ Done.", rule, "❯ Try \"write a test for <filepath>\"", rule], { unnumbered: true }).options).toEqual([]);
});

test("unnumbered menu with descriptions under each option", () => {
  const tail = [
    " Setting up Claude in Chrome",
    " ❯ Continue with browser tools",
    "     Claude picks the task back up in your browser",
    "   Continue without browser tools",
    "     Finish setup later with /chrome",
  ];
  const v = parseScreen(tail, { unnumbered: true });
  expect(v.options.map((o) => o.label)).toEqual(["Continue with browser tools", "Continue without browser tools"]);
});

test("auto-deliver delivers a held message", () => {
  const pick = autoChoice(parseScreen(HELD, { unnumbered: true }));
  expect(pick?.option.label).toBe("Deliver this message to Claude");
  expect(pick?.option.n).toBe(2);
});

test("auto-deliver picks the recommended option, never a free-text one", () => {
  const tail = [
    " Which cache should the API use?",
    " ❯ 1. Redis (Recommended)",
    "      Already running in staging",
    "   2. In-memory",
    "      Simplest, lost on restart",
    "   3. Type something.",
  ];
  const pick = autoChoice(parseScreen(tail));
  expect(pick?.option.n).toBe(1);
  expect(pick?.text).toBe("Picked “Redis”");
  expect(autoChoice({ lines: [], options: [
    { n: 1, label: "Yes", selected: true, freeText: false },
    { n: 2, label: "Something else (recommended)", selected: false, freeText: true },
  ] })).toBeNull();
});

test("auto-deliver leaves permission prompts and plain questions to you", () => {
  const perm = [" Bash command", "   rm -rf build", " Do you want to proceed?", " ❯ 1. Yes", "   2. Yes, and don't ask again for rm commands", "   3. No, and tell Claude what to do differently (esc)"];
  expect(autoChoice(parseScreen(perm))).toBeNull();
  const plain = [" Pick a colour", " ❯ 1. Red", "   2. Green", "   3. Type something."];
  expect(autoChoice(parseScreen(plain))).toBeNull();
});

test("auto-deliver skips pick-any questions and submits only complete answers", () => {
  const multi = [" Which checks?", " ❯ 1. [ ] Lint (Recommended)", "   2. [ ] Tests"];
  expect(autoChoice(parseScreen(multi))).toBeNull();
  const review = [" Review your answers", "  → Which cache? Redis", " Ready to submit your answers?", " ❯ 1. Submit answers", "   2. Cancel"];
  expect(autoChoice(parseScreen(review))?.text).toBe("Submitted the answers");
  const partial = [" Review your answers", " ⚠ You have not answered all questions", " Ready to submit your answers?", " ❯ 1. Submit answers", "   2. Cancel"];
  expect(autoChoice(parseScreen(partial))).toBeNull();
});

// Claude's AskUserQuestion with two questions, the first pick-any (read off a live screen).
const MULTI = [
  "─".repeat(80),
  "←  ☒ Additions  ☐ Scope  ✔ Submit  →",
  "Which additions should the refactor also do?",
  "❯ 1. [ ] Comments",
  "         Remove comments that only restate the code.",
  "  2. [✔] Tests",
  "         Remove tests that cannot catch a real bug.",
  "  3. [ ] Type something",
  "     Next",
  "─".repeat(80),
  "  4. Chat about this",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
];

test("Claude pick-any question with tabs", () => {
  const v = parseScreen(MULTI);
  expect(v.multi).toBe(true);
  expect(v.steps).toBe(true);
  expect(v.tabs).toEqual([{ label: "Additions", done: true }, { label: "Scope", done: false }, { label: "Submit", done: true }]);
  expect(v.options.map((o) => [o.label, o.checked])).toEqual([["Comments", false], ["Tests", true], ["Type something", false], ["Chat about this", undefined]]);
  expect(v.options[0].description).toBe("Remove comments that only restate the code.");
  expect(v.options[2].freeText).toBe(true);
  expect(v.options[2].description).toBeUndefined(); // "Next" is the step row, not a description
  expect(v.lines[0]).toBe("Which additions should the refactor also do?");
  expect(autoChoice(v)).toBeNull(); // pick-any questions are yours
});

test("Codex question: same-line descriptions and question count", () => {
  const tail = ["  Question 1/2 (2 unanswered)", "  Choose an option.", "", "  › 1. Option 1 (Recommended)  First choice.", "    2. Option 2  Second choice.", "    3. None of the above  Optionally, add details in notes (tab)", "", "  tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt"];
  const v = parseScreen(tail);
  expect(v.options.map((o) => o.label)).toEqual(["Option 1 (Recommended)", "Option 2", "None of the above"]);
  expect(v.options[1].description).toBe("Second choice.");
  expect(v.steps).toBe(true);
  expect(autoChoice(v)?.text).toBe("Picked “Option 1”");
});

test("Gemini question and approval", () => {
  const q = ["Which authentication method should we use?", "", "● 1.  OAuth 2.0", "      Industry standard, supports SSO", "  2.  JWT tokens", "      Stateless, good for APIs", "  3.  Enter a custom value", "", "Enter to select · ↑/↓ to navigate · Esc to cancel"];
  const v = parseScreen(q);
  expect(v.options.map((o) => o.label)).toEqual(["OAuth 2.0", "JWT tokens", "Enter a custom value"]);
  expect(v.options[0].description).toBe("Industry standard, supports SSO");
  expect(v.options[2].freeText).toBe(true);
  const a = ["│ ? Shell  list files                                1 of 3 │", "│ Allow execution of [Shell]?                               │", "│                                                           │", "│ ● 1. Allow once                                           │", "│   2. Allow for this session                               │", "│   3. No, suggest changes (esc)                            │"];
  expect(parseScreen(a).options.map((o) => o.label)).toEqual(["Allow once", "Allow for this session", "No, suggest changes (esc)"]);
});

test("Kimi approval and bracketed question numbers", () => {
  const a = ["  ▶ Run this command?", "  $ ls -la", "", "  ▶ 1. Approve once", "    2. Approve for this session", "    3. Reject", "    4. Reject with feedback", "", "  ↑/↓ select · 1/2/3/4 choose · ↵ confirm"];
  expect(parseScreen(a).options.map((o) => o.label)).toEqual(["Approve once", "Approve for this session", "Reject", "Reject with feedback"]);
  const q = [" ? Which database?", "  → [1] Postgres (Recommended)", "    [2] SQLite", "    [3] Other"];
  const v = parseScreen(q);
  expect(v.options.map((o) => o.label)).toEqual(["Postgres (Recommended)", "SQLite", "Other"]);
  expect(autoChoice(v)?.option.n).toBe(1);
  expect(autoChoice(parseScreen(["  → [1] Submit", "    [2] Cancel"]))?.text).toBe("Submitted the answers");
});

test("pi and OMP pointer lists, Goose radio lists", () => {
  const pi = ["─".repeat(30), "", " Run tests?", " npm test", "", " → Yes", "   No", "", " ↑↓ navigate  enter select  escape/ctrl+c cancel", "", "─".repeat(30)];
  expect(parseScreen(pi, { unnumbered: true }).options.map((o) => [o.label, o.selected])).toEqual([["Yes", true], ["No", false]]);
  const omp = ["╭─ Allow tool: bash ─────────────────────╮", "│ Command: npm test                      │", "│ ❯ Approve                              │", "│   Approve bash for this session        │", "│   Deny                                 │", "├────────────────────────────────────────┤", "│ ↑/↓ choose · ⏎ select · ⌃⏎/⌃Q approve …│", "╰────────────────────────────────────────╯"];
  expect(parseScreen(omp, { unnumbered: true }).options.map((o) => o.label)).toEqual(["Approve", "Approve bash for this session", "Deny"]);
  const form = ["│ Session store                          │", "│ ❯ ◉ SQLite: one file, no new service   │", "│   ○ Redis: shared across instances     │", "│   ○ Other: type your own               │", "│                                        │"];
  const f = parseScreen(form, { unnumbered: true });
  expect(f.options.map((o) => o.label)).toEqual(["SQLite: one file, no new service", "Redis: shared across instances", "Other: type your own"]);
  expect(f.options[2].freeText).toBe(true);
  const goose = ["◆  Goose would like to call the above tool, do you allow?", "│  ● Allow (Allow the tool call once)", "│  ○ Always Allow ", "│  ○ Deny ", "│  ○ Cancel ", "└  "];
  expect(parseScreen(goose, { unnumbered: true }).options.map((o) => [o.label, o.selected])).toEqual([["Allow (Allow the tool call once)", true], ["Always Allow", false], ["Deny", false], ["Cancel", false]]);
});

test("button prompts are answered with each harness's keys", () => {
  const oc = ["┃ △ Permission required", "┃ $ rm -rf build", "┃", "┃  Allow once   Always allow   Reject ", "  ctrl+f fullscreen  ⇆ select  enter confirm"];
  const v = parseScreen(oc, { agent: "opencode" });
  expect(v.options.map((o) => [o.label, o.keys])).toEqual([["Allow once", ["\r"]], ["Always allow", ["\x1b[C", "\r"]], ["Reject", ["\x1b"]]]);
  expect(parseScreen(oc).options).toEqual([]); // without knowing it's OpenCode, don't guess
  const crush = ["Permission Required ╱╱╱╱╱╱", "Tool bash", "Path ~/code", "  Allow      Allow for Session      Deny  ", "←/→ choose • enter confirm • esc exit"];
  expect(parseScreen(crush, { agent: "crush" }).options.map((o) => o.keys)).toEqual([["a"], ["s"], ["d"]]);
  expect(parseScreen(["Approve tool call?", "[y] approve  [n] deny"], { agent: "cline" }).options.map((o) => o.label)).toEqual(["Approve", "Deny"]);
  const aider = ["Run shell command? (Y)es/(N)o/(D)on't ask again [Yes]: "];
  expect(parseScreen(aider, { agent: "aider" }).options.map((o) => [o.label, o.keys])).toEqual([["Yes", ["y", "\r"]], ["No", ["n", "\r"]], ["Don't ask again", ["d", "\r"]]]);
});
