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
