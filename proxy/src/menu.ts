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
  /** Pick-any questions: whether this box is ticked ("[✔]", "[x]", "☑"). Absent on ordinary options. */
  checked?: boolean;
  /** The line(s) under the option, or after it on the same line (Codex). */
  description?: string;
  /** Exact keystrokes that pick it, for prompts drawn as buttons whose highlight is colour only. */
  keys?: string[];
}

export interface MenuTab {
  label: string;
  /** Answered (☒ / ✔ in Claude's tab bar). */
  done: boolean;
}

export interface ScreenView {
  lines: string[];
  options: MenuOption[];
  /** false when the menu has no numbers: `n` is then the option's position, picked with ↑/↓ and Enter. */
  numbered: boolean;
  /** A pick-any question: picking an option toggles its box, and Next (→) moves on. */
  multi?: boolean;
  /** Several questions at once: Claude's tab bar ("☒ Additions ☐ Scope ✔ Submit"). */
  tabs?: MenuTab[];
  /** ← and → move between the questions (a tab bar, Codex's "Question 1/2", a pick-any "Next" row). */
  steps?: boolean;
}

// "❯ 1. Yes", "› 1. Yes", "● 1.  Allow once" (Gemini), "▶ 1. Approve once" / "→ [1] Postgres" (Kimi).
const OPTION = /^[\s│┃|]*([❯›>▶→●]\s*)?(?:(\d{1,2})[.)]|\[(\d{1,2})\])\s+(.+?)[\s│┃|]*$/;
const POINTER = /^(\s*)[❯›▶→]\s+(\S.*)$/;
const RULE = /^[\s─━═╭╮╰╯│┃|┌┐└┘-]*$/;
const DOTTED = /^[\s╌╍┄┅┈┉]+$/;
const FOOTER = /(Enter to (select|confirm)|↑\/↓|Esc to (cancel|interrupt)|shift\+tab to cycle|\? for shortcuts)/i;
const FREE_TEXT = /(type something|tell \w+ what to do differently|something else|^other\b|custom (answer|value)|type your own)/i;
/** A box in front of a pick-any option: Claude "[✔]", Gemini "[x]", OMP "☑". */
const BOX = /^(?:\[([ x✓✔×✗])?\]|([☐☑☒◻◼□■]))\s+/i;
/** A radio dot in front of an option (OMP "◉ SQLite" / "○ Redis"). */
const RADIO = /^[◉○◯]\s+/;
/** The row that moves a pick-any question on (Claude "Next", Gemini "Done"). */
const NAV = /^(next|done)$/i;
/** Claude's question tabs: "←  ☒ Additions  ☐ Scope  ✔ Submit  →". */
const TAB_BAR = /^\s*←\s+(.*?)\s*→\s*$/;
const TAB_MARK = /([☐☒☑✔✓□■])/;
/** Codex: "Question 1/2 (1 unanswered)". */
const QUESTION_N = /^\s*Question \d+\/\d+\b/;

function clean(line: string): string {
  return line.replace(/^[\s]*[│┃|]\s?/, "").replace(/\s*[│┃|]\s*$/, "").replace(/\s+$/, "");
}

type Found = { idx: number; opt: MenuOption }[];

/** Split a box or radio dot off the label, and Codex's same-line description after two spaces. */
function shape(opt: MenuOption): MenuOption {
  let label = opt.label;
  const box = BOX.exec(label);
  if (box) {
    label = label.slice(box[0].length);
    opt.checked = box[1] !== undefined ? box[1] !== " " : box[2] !== undefined ? "☑☒◼■".includes(box[2]) : false;
  }
  label = label.replace(RADIO, "");
  const gap = /\s{2,}/.exec(label);
  if (gap) {
    const rest = label.slice(gap.index + gap[0].length);
    label = label.slice(0, gap.index);
    if (!/^[│┃|╭╰─]/.test(rest)) opt.description = rest; // a side-by-side preview box is not a description
  }
  opt.label = label.trim();
  opt.freeText = FREE_TEXT.test(opt.label);
  return opt;
}

/** The indented lines under each option are its description; stop at a rule, a footer or the "Next" row. */
function describe(window: string[], found: Found): boolean {
  let nav = false;
  found.forEach((f, k) => {
    if (f.opt.keys) return;
    const indent = window[f.idx].search(/\S/);
    const end = k + 1 < found.length ? found[k + 1].idx : Math.min(window.length, f.idx + 4);
    const text: string[] = [];
    for (let i = f.idx + 1; i < end; i++) {
      const raw = window[i];
      const t = clean(raw).trim();
      if (!t) continue;
      if (RULE.test(raw) || DOTTED.test(raw) || FOOTER.test(raw)) break;
      if (NAV.test(t)) {
        nav = true;
        break;
      }
      if (raw.search(/\S/) <= indent) break;
      text.push(t);
    }
    if (text.length && !f.opt.description) f.opt.description = text.join(" ");
  });
  return nav;
}

/** A numbered menu: a run of option lines counting 1..k, read upward from the bottom. */
function numberedMenu(window: string[]): Found {
  const found: Found = [];
  for (let i = window.length - 1; i >= 0; i--) {
    const m = OPTION.exec(window[i]);
    if (!m) continue;
    const n = Number(m[2] ?? m[3]);
    const label = m[4].trim();
    if (found.length && n >= found[0].opt.n) break; // numbering must decrease going up
    found.unshift({ idx: i, opt: shape({ n, label, selected: !!m[1], freeText: false }) });
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
  let rows = window.map(clean);
  // Goose (cliclack) marks the highlighted row with ● and the rest with ○.
  if (!rows.some((r) => POINTER.test(r)) && rows.some((r) => /^\s*●\s/.test(r)))
    rows = rows.map((r) => r.replace(/^(\s*)●(\s)/, "$1❯$2").replace(/^(\s*)○(\s)/, "$1 $2"));
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
    found.push({ idx: i, opt: shape({ n: found.length + 1, label, selected: i === at, freeText: false }) });
  }
  return found.length >= 2 ? found : [];
}

const ESC = "\x1b";
const RIGHT = "\x1b[C";
const opt = (n: number, label: string, keys: string[]): MenuOption => ({ n, label, selected: false, freeText: false, keys });

/**
 * Prompts drawn as a row of buttons, where only colour shows the highlight. They are answered
 * with the keys each harness documents rather than read off the screen:
 * OpenCode (Enter takes the first button, Esc rejects), Crush (a/s/d), Cline (y/n), Aider (y/n/d, Enter).
 */
function buttonPrompt(agent: string, window: string[]): Found {
  const text = window.map(clean);
  const at = (re: RegExp) => text.findIndex((l) => re.test(l));
  const found: Found = [];
  if (agent === "opencode" || agent === "opencode2" || agent === "zcode") {
    const row = at(/Allow once.*Reject/);
    if (row < 0 || at(/Permission required/i) < 0) return [];
    found.push({ idx: row, opt: opt(1, "Allow once", ["\r"]) });
    if (/Always allow/.test(text[row])) found.push({ idx: row, opt: opt(2, "Always allow", [RIGHT, "\r"]) });
    found.push({ idx: row, opt: opt(found.length + 1, "Reject", [ESC]) });
  } else if (agent === "crush") {
    const row = at(/\bAllow\b.*\bDeny\b/);
    if (row < 0 || at(/Permission Required/i) < 0) return [];
    found.push({ idx: row, opt: opt(1, "Allow", ["a"]) }, { idx: row, opt: opt(2, "Allow for session", ["s"]) }, { idx: row, opt: opt(3, "Deny", ["d"]) });
  } else if (agent === "cline") {
    const row = at(/\[y\]\s*approve.*\[n\]\s*deny/i);
    if (row < 0) return [];
    found.push({ idx: row, opt: opt(1, "Approve", ["y"]) }, { idx: row, opt: opt(2, "Deny", ["n"]) });
  } else if (agent === "aider") {
    const row = text.length - 1 - [...text].reverse().findIndex((l) => /\(Y\)es\/\(N\)o/.test(l));
    if (row >= text.length) return [];
    found.push({ idx: row, opt: opt(1, "Yes", ["y", "\r"]) }, { idx: row, opt: opt(2, "No", ["n", "\r"]) });
    if (/\(D\)on't ask again/.test(text[row])) found.push({ idx: row, opt: opt(3, "Don't ask again", ["d", "\r"]) });
  }
  return found;
}

export function parseScreen(tail: string[], opts: { unnumbered?: boolean; agent?: string } = {}, lookback = 30): ScreenView {
  const start = Math.max(0, tail.length - lookback);
  const window = tail.slice(start);

  let found = opts.agent ? buttonPrompt(opts.agent, window) : [];
  let numbered = true;
  if (!found.length) found = numberedMenu(window);
  if (!found.length && opts.unnumbered) {
    found = unnumberedMenu(window);
    numbered = false;
  }
  const isMenu = found.length > 0;
  const nav = isMenu && describe(window, found);
  const options = found.map((f) => f.opt);
  const multi = options.some((o) => o.checked !== undefined);

  // Claude's tab bar and Codex's "Question 1/2" sit just above the question.
  let tabs: MenuTab[] | undefined;
  let counted = false;
  if (isMenu) {
    for (let i = found[0].idx - 1; i >= Math.max(0, found[0].idx - 12); i--) {
      const bar = TAB_BAR.exec(clean(window[i]));
      if (bar && (bar[1].match(new RegExp(TAB_MARK.source, "g")) ?? []).length >= 2) {
        const parts = bar[1].split(TAB_MARK).map((p) => p.trim());
        tabs = [];
        for (let j = 1; j < parts.length; j += 2) if (parts[j + 1]) tabs.push({ label: parts[j + 1], done: parts[j] !== "☐" && parts[j] !== "□" });
        break;
      }
      if (QUESTION_N.test(window[i])) counted = true;
    }
  }

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
    .filter((l) => !RULE.test(l) && !DOTTED.test(l) && !FOOTER.test(l) && !(tabs && TAB_BAR.test(clean(l))))
    .map(clean)
    .filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""));
  const view: ScreenView = { lines, options, numbered: isMenu ? numbered : true };
  if (multi) view.multi = true;
  if (tabs?.length) view.tabs = tabs;
  if (tabs?.length || counted || (multi && nav)) view.steps = true;
  return view;
}

const DELIVER = /^deliver this message\b/i;
/** The option that releases a message another session sent and Claude held for you. */
export const isDeliver = (label: string) => DELIVER.test(label);
const RECOMMENDED = /\(recommended\)/i;
const SUBMIT = /^submit( answers)?$/i;
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
/** What auto-deliver answers when an agent's question marks no option as recommended. */
export const LET_AGENT_CHOOSE = "No preference. Go with the option you'd recommend and carry on.";
const CHAT = /^chat about this$/i;
/** A prompt asking for permission or approval (to run, edit, trust, accept a plan): always yours. */
const APPROVAL = /\b(do you want to|would you like to proceed|proceed\?|allow|approve|permission|trust (this|the) (folder|directory)|ready to code|auto-accept)\b/i;

export interface AutoPick {
  option: MenuOption;
  /** For the banner and the log. */
  text: string;
  /** Type this through the option (a free-text answer) instead of picking it. */
  say?: string;
}

/**
 * The answer auto-deliver gives, or null when the prompt is yours:
 * - a held message from another session: deliver it;
 * - an option marked "(Recommended)": pick it;
 * - a finished multi-question form: submit it;
 * - with `letAgentChoose`, a question (never a permission or plan prompt) that recommends nothing:
 *   answer through its free-text option that the agent should go with what it would recommend.
 */
export function autoChoice(
  view: Pick<ScreenView, "lines" | "options"> & { multi?: boolean },
  opts: { deliver?: boolean; answer?: boolean; letAgentChoose?: boolean; question?: boolean } = {},
): AutoPick | null {
  const { options, lines } = view;
  if (options.length < 2) return null;
  const pickAny = !!view.multi || options.some((o) => o.checked !== undefined || CHECKBOX.test(o.label));
  const deliver = options.find((o) => DELIVER.test(o.label));
  if (deliver) return opts.deliver === false || pickAny ? null : { option: deliver, text: "Delivered the held message" };
  if (opts.answer === false) return null;
  if (!pickAny) {
    const rec = options.find((o) => !o.freeText && RECOMMENDED.test(o.label));
    if (rec) return { option: rec, text: `Picked “${rec.label.replace(RECOMMENDED, "").trim()}”` };
    const submit = options.find((o) => SUBMIT.test(o.label));
    if (submit && !lines.some((l) => UNANSWERED.test(l))) return { option: submit, text: "Submitted the answers" };
  }
  if (opts.letAgentChoose && !pickAny) {
    const question = opts.question || options.some((o) => CHAT.test(o.label));
    const approval = [...lines, ...options.map((o) => o.label)].some((l) => APPROVAL.test(l));
    const free = options.find((o) => o.freeText);
    if (question && !approval && free) return { option: free, text: "Let the agent choose (nothing was marked recommended)", say: LET_AGENT_CHOOSE };
  }
  return null;
}

/** Why auto-deliver left a prompt to you, for the log. */
export function whyNot(view: Pick<ScreenView, "lines" | "options"> & { multi?: boolean }, opts: { deliver?: boolean; answer?: boolean } = {}): string {
  if (view.options.length < 2) return "no menu on screen";
  if (view.options.some((o) => DELIVER.test(o.label))) return opts.deliver === false ? "delivering messages automatically is off" : "a held message";
  if (opts.answer === false) return "answering questions automatically is off";
  if (view.multi || view.options.some((o) => o.checked !== undefined || CHECKBOX.test(o.label))) return "a pick-any question";
  if ([...view.lines, ...view.options.map((o) => o.label)].some((l) => APPROVAL.test(l))) return "a permission or approval prompt";
  if (!view.options.some((o) => o.freeText)) return "no recommended option and no free-text answer";
  return "no recommended option";
}
