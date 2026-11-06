// Pull the numbered choice menu out of an agent's rendered screen.
// Claude Code (AskUserQuestion, permission prompts) and Codex (approvals) both draw
// "❯ 1. Yes" / "  2. No …" style menus where typing the digit picks the option.

export interface MenuOption {
  n: number;
  label: string;
  selected: boolean;
  /** Picking it opens a text box (e.g. "Type something.", "No, and tell Claude what to do differently"). */
  freeText: boolean;
}

export interface ScreenView {
  lines: string[];
  options: MenuOption[];
}

const OPTION = /^[\s│┃|]*([❯›>▶→●]\s*)?(\d{1,2})[.)]\s+(.+?)[\s│┃|]*$/;
const RULE = /^[\s─━═╭╮╰╯│┃|┌┐└┘-]*$/;
const FOOTER = /(Enter to (select|confirm)|↑\/↓|Esc to (cancel|interrupt)|shift\+tab to cycle|\? for shortcuts)/i;
const FREE_TEXT = /(type something|tell \w+ what to do differently|something else|^other\b|custom answer)/i;

function clean(line: string): string {
  return line.replace(/^[\s]*[│┃|]\s?/, "").replace(/\s*[│┃|]\s*$/, "").replace(/\s+$/, "");
}

export function parseScreen(tail: string[], lookback = 30): ScreenView {
  const start = Math.max(0, tail.length - lookback);
  const window = tail.slice(start);

  // Walk upward from the bottom collecting option lines; a menu is a run that counts 1..k.
  const found: { idx: number; opt: MenuOption }[] = [];
  for (let i = window.length - 1; i >= 0; i--) {
    const m = OPTION.exec(window[i]);
    if (!m) continue;
    const n = Number(m[2]);
    const label = m[3].trim();
    if (found.length && n >= found[0].opt.n) break; // numbering must decrease going up
    found.unshift({ idx: i, opt: { n, label, selected: !!m[1], freeText: FREE_TEXT.test(label) } });
    if (n === 1) break;
  }
  const isMenu = found.length >= 2 && found[0].opt.n === 1 && found.every((f, k) => f.opt.n === k + 1);
  const options = isMenu ? found.map((f) => f.opt) : [];

  let from = 0;
  let to = window.length;
  if (isMenu) {
    from = Math.max(0, found[0].idx - 8);
    // Start just after the separator that opens the menu box, if there is one.
    for (let i = found[0].idx - 1; i >= from; i--) {
      if (RULE.test(window[i]) && window[i].trim().length > 3) {
        from = i + 1;
        break;
      }
    }
    to = Math.min(window.length, found[found.length - 1].idx + 3);
  } else {
    from = Math.max(0, window.length - 14);
  }
  const lines = window
    .slice(from, to)
    .filter((l) => !RULE.test(l) && !FOOTER.test(l))
    .map(clean)
    .filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""));
  return { lines, options };
}
