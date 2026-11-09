import { expect, test } from "bun:test";
import { parseScreen } from "./menu";

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
