// Small line icons standing in for the Mac app's SF Symbols. 24×24 grid, stroked.

import type { JSX } from "preact";

const P: Record<string, JSX.Element> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M12 7v6" stroke="#000" stroke-width="2.6" />
      <circle cx="12" cy="16.8" r="1.5" fill="#000" stroke="none" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="#000" stroke-width="2.4" />
    </>
  ),
  sparkle: <path d="M12 2.5c.8 4.6 2.9 6.7 7.5 7.5-4.6.8-6.7 2.9-7.5 7.5-.8-4.6-2.9-6.7-7.5-7.5 4.6-.8 6.7-2.9 7.5-7.5z" fill="currentColor" stroke="none" />,
  bolt: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M13 6.5l-4 6h4l-2 5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  pin: <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5zM12 13v7.5" />,
  pinFill: <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5zM12 13v7.5" fill="currentColor" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  open: (
    <>
      <rect x="3.5" y="5.5" width="15" height="15" rx="3.5" />
      <path d="M12 3.5h8.5V12M20.5 3.5L11 13" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M6.5 9l3 3-3 3M12 15.5h5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <path d="M4 4l16 16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  plusRect: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  plane: <path d="M3 11.5L21 3l-6.5 18-3-7.5zM11.5 13.5L21 3" />,
  square: <rect x="4" y="4" width="16" height="16" rx="3.5" />,
  checkSquare: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" fill="currentColor" />
      <path d="M8 12.5l3 3 5-6" stroke="#000" stroke-width="2.4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5l5 5" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  wave: <path d="M4 12h1M8 8v8M12 5v14M16 8v8M20 11v2" />,
  bubble: <path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z" />,
  doc: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  pencil: <path d="M4 20l1-4.5L16 4.5l3.5 3.5-11 11zM14 7l3 3" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M16 4.8a3.3 3.3 0 010 6.4M18 14c2 .7 3.2 2.6 3.5 6" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2" />,
  question: (
    <>
      <path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z" />
      <path d="M10 8.8a2 2 0 113 1.7c-.7.4-1 .8-1 1.5M12 13.6h.01" />
    </>
  ),
  wrench: <path d="M14.5 5.5a4 4 0 00-5 5L4 16l4 4 5.5-5.5a4 4 0 005-5l-2.5 2.5-3-1-1-3z" />,
  branch: (
    <>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="8" r="2" />
      <path d="M6.5 7.5v9M17.5 10c0 4-11 2.5-11 6.5" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  power: <path d="M12 3v8M7 6.3a7.5 7.5 0 1010 0" />,
  dots: <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" />,
  person: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20c.6-4.5 3.3-7 7-7s6.4 2.5 7 7" />
    </>
  ),
  folder: <path d="M3 6.5h6l2 2h10v10.5H3z" />,
};

export function Icon({ name, size = 12, class: cls, style }: { name: keyof typeof P | string; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <svg
      class={`icon ${cls ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={style}
      aria-hidden="true"
    >
      {P[name] ?? P.wrench}
    </svg>
  );
}

/** A tiny orca fin: Floe's idle glyph. */
export function OrcaGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M8 86 C42 72 40 22 62 6 C60 45 70 75 92 86 Z" fill="currentColor" />
    </svg>
  );
}

export function toolIcon(tool: string | null | undefined, kind: string): string {
  if (kind === "say") return "bubble";
  switch ((tool ?? "").toLowerCase()) {
    case "bash":
    case "shell":
    case "exec":
    case "exec_command":
    case "local_shell":
      return "terminal";
    case "read":
    case "view":
    case "notebookread":
      return "doc";
    case "edit":
    case "multiedit":
    case "write":
    case "apply_patch":
    case "notebookedit":
    case "str_replace_editor":
      return "pencil";
    case "grep":
    case "glob":
    case "search":
    case "ls":
    case "find":
      return "search";
    case "webfetch":
    case "websearch":
    case "fetch":
    case "web_search":
      return "globe";
    case "task":
    case "agent":
    case "dispatch_agent":
      return "people";
    case "todowrite":
    case "update_plan":
      return "list";
    case "askuserquestion":
      return "question";
    default:
      return "wrench";
  }
}
