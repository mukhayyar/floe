// Pull the choice menu out of an agent's rendered screen.
// Claude Code (AskUserQuestion, permission prompts) and Codex (approvals) draw
// "❯ 1. Yes" / "  2. No …" style menus where typing the digit picks the option. Some Claude
// Code dialogs hide the numbers ("❯ Deny — …" / "  Deliver this message to Claude", for a
// message held from another session): those are picked by moving the ❯ with the arrow keys.

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
  /** false when the menu has no numbers: `n` is then the option's position, picked with ↑/↓ and Enter. */
  numbered: boolean;
}

const OPTION = /^[\s│┃|]*([❯›>▶→●]\s*)?(\d{1,2})[.)]\s+(.+?)[\s│┃|]*$/;
const POINTER = /^(\s*)[❯›▶→]\s+(\S.*)$/;
const RULE = /^[\s─━═╭╮╰╯│┃|┌┐└┘-]*$/;
const DOTTED = /^[\s╌╍┄┅┈┉]+$/;
const FOOTER = /(Enter to (select|confirm)|↑\/↓|Esc to (cancel|interrupt)|shift\+tab to cycle|\? for shortcuts)/i;
const FREE_TEXT = /(type something|tell \w+ what to do differently|something else|^other\b|custom answer)/i;

function clean(line: string): string {
  return line.replace(/^[\s]*[│┃|]\s?/, "").replace(/\s*[│┃|]\s*$/, "").replace(/\s+$/, "");
}

type Found = { idx: number; opt: MenuOption }[];

/** A numbered menu: a run of option lines counting 1..k, read upward from the bottom. */
function numberedMenu(window: string[]): Found {
  const found: Found = [];
  for (let i = window.length - 1; i >= 0; i--) {
    const m = OPTION.exec(window[i]);
    if (!m) continue;
    const n = Number(m[2]);
    const label = m[3].trim();
    if (found.length && n >= found[0].opt.n) break; // numbering must decrease going up
    found.unshift({ idx: i, opt: { n, label, selected: !!m[1], freeText: FREE_TEXT.test(label) } });
    if (n === 1) break;
  }
  const ok = found.length >= 2 && found[0].opt.n === 1 && found.every((f, k) => f.opt.n === k + 1);
  return ok ? found : [];
}

/**
 * A menu without numbers: the last ❯ line plus the lines beside it whose label starts in the
 * same column (deeper-indented lines are an option's description). Claude's own prompt box
 * also starts with ❯, so the caller only asks for this while the agent is blocked on a
 * prompt, and a ❯ line boxed in by rules (the prompt box) never counts.
 */
function unnumberedMenu(window: string[]): Found {
  const rows = window.map(clean);
  let at = -1;
  for (let i = rows.length - 1; i >= 0 && at < 0; i--) if (POINTER.test(rows[i])) at = i;
  if (at < 0) return [];
  const m = POINTER.exec(rows[at])!;
  const col = rows[at].length - m[2].length; // where labels start
  const kind = (row: string): "option" | "more" | null => {
    if (row.length <= col || row.slice(0, col).trim() !== "") return null;
    return row[col] !== " " ? "option" : "more";
  };
  let first = at;
  let last = at;
  while (first > 0 && kind(rows[first - 1])) first--;
  while (last < rows.length - 1 && kind(rows[last + 1])) last++;
  const before = rows[first - 1] ?? "";
  const after = rows[last + 1] ?? "";
  if (RULE.test(before) && before.trim().length > 3 && RULE.test(after) && after.trim().length > 3) return [];

  const found: Found = [];
  for (let i = first; i <= last; i++) {
    if (i !== at && kind(rows[i]) !== "option") continue;
    const label = (i === at ? m[2] : rows[i].slice(col)).trim();
    found.push({ idx: i, opt: { n: found.length + 1, label, selected: i === at, freeText: FREE_TEXT.test(label) } });
  }
  return found.length >= 2 ? found : [];
}

export function parseScreen(tail: string[], opts: { unnumbered?: boolean } = {}, lookback = 30): ScreenView {
  const start = Math.max(0, tail.length - lookback);
  const window = tail.slice(start);

  let found = numberedMenu(window);
  let numbered = true;
  if (!found.length && opts.unnumbered) {
    found = unnumberedMenu(window);
    numbered = false;
  }
  const isMenu = found.length > 0;
  const options = found.map((f) => f.opt);

  let from = 0;
  let to = window.length;
  if (isMenu) {
    from = Math.max(0, found[0].idx - 14);
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
    .filter((l) => !RULE.test(l) && !DOTTED.test(l) && !FOOTER.test(l))
    .map(clean)
    .filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""));
  return { lines, options, numbered: isMenu ? numbered : true };
}

const DELIVER = /^deliver this message\b/i;
const RECOMMENDED = /\(recommended\)/i;
const SUBMIT = /^submit answers$/i;
const UNANSWERED = /not answered all questions/i;
/** A pick-any question: a digit toggles a box instead of answering, so Floe never auto-picks it. */
const CHECKBOX = /^(\[[ x✓✔×]?\]|[☐☑☒◻◼□■])\s/i;

/**
 * What auto-deliver picks on this screen, if anything:
 * - a message held from another session → "Deliver this message to Claude";
 * - a question with an option marked "(Recommended)" → that option;
 * - the review step after several questions, once all are answered → "Submit answers".
 * Anything else (permission prompts, questions with no recommendation) is left to you.
 */
export function autoChoice(view: Pick<ScreenView, "lines" | "options">): { option: MenuOption; text: string } | null {
  const { options, lines } = view;
  if (options.length < 2 || options.some((o) => CHECKBOX.test(o.label))) return null;
  const deliver = options.find((o) => DELIVER.test(o.label));
  if (deliver) return { option: deliver, text: "Delivered the held message" };
  const rec = options.find((o) => !o.freeText && RECOMMENDED.test(o.label));
  if (rec) return { option: rec, text: `Picked “${rec.label.replace(RECOMMENDED, "").trim()}”` };
  const submit = options.find((o) => SUBMIT.test(o.label));
  if (submit && !lines.some((l) => UNANSWERED.test(l))) return { option: submit, text: "Submitted the answers" };
  return null;
}
