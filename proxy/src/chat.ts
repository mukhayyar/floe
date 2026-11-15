// Orca's chat tabs ("structured agent sessions"): Claude or Codex running in Orca's own chat view
// instead of a terminal. There is no screen to read and no keys to type. A question or a
// permission prompt is an item in the session's journal: Floe reads it with agentSession.history
// and answers with agentSession.respondToQuestion / respondToApproval, the calls Orca's own
// clients make (src/main/runtime/rpc/methods/structured-sessions in Orca's source).
//
// Every write carries an envelope: a fresh operation id, the session's fence, and a sha256 of the
// request's fields in canonical form (keys sorted, undefined dropped), which the host recomputes.

import { createHash, randomUUID } from "node:crypto";
import type { MenuOption, MenuTab, ScreenView } from "./menu";

const PREFIX = "structured-agent-session-";
/** What a paired host wants a client to say before it serves chat sessions to it. */
export const CHAT_CAPS = ["agent-session.structured.v1"];
export const FREE_TEXT = "Type something.";
/** Orca's id for an item that is its own single question (agentSessionPromptQuestions). */
const SINGLE_QUESTION_ID = "q1";

/** The chat session behind an agent row, or null for a terminal agent. */
export function chatSessionId(paneKey: string): string | null {
  if (!paneKey.startsWith(PREFIX)) return null;
  const id = paneKey.slice(PREFIX.length).split(":")[0];
  return id || null;
}

export interface ChatOption {
  id: string;
  label: string;
  description?: string;
  intent?: string;
}

export interface ChatQuestion {
  id: string;
  question: string;
  header?: string;
  multiSelect: boolean;
  options: ChatOption[];
  freeTextQuestionId?: string;
}

/** A question or permission prompt waiting in a chat. */
export interface ChatPrompt {
  itemId: string;
  revision: number;
  kind: "question" | "approval";
  /** Approvals: what the agent wants to do ("Bash", "Edit src/app.ts"). */
  title: string;
  lines: string[];
  options: ChatOption[];
  questions: ChatQuestion[];
}

/** Answers picked so far on a multi-question prompt, and which question is showing. */
export interface ChatDraft {
  itemId: string;
  at: number;
  answers: Record<string, { optionIds: string[]; other?: string }>;
}

export type ChatAnswer = { optionId: string } | { answers: { questionId: string; optionIds: string[]; other?: string }[] };

const text = (v: unknown) => (typeof v === "string" ? v : "");

function options(raw: unknown): ChatOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o) => o && typeof o.id === "string" && typeof o.label === "string")
    .map((o) => ({ id: o.id, label: o.label, ...(o.description ? { description: String(o.description) } : {}), ...(o.intent ? { intent: String(o.intent) } : {}) }));
}

/** The questions an item asks: its grouped list, or the item itself as one question. */
export function questionsOf(body: any): ChatQuestion[] {
  if (Array.isArray(body?.questions) && body.questions.length) {
    return body.questions.map((q: any) => ({
      id: String(q.id),
      question: text(q.question),
      ...(q.header ? { header: String(q.header) } : {}),
      multiSelect: q.multiSelect === true,
      options: options(q.options),
      ...(q.freeTextQuestionId ? { freeTextQuestionId: String(q.freeTextQuestionId) } : {}),
    }));
  }
  return [{
    id: body?.freeTextQuestionId ? String(body.freeTextQuestionId) : SINGLE_QUESTION_ID,
    question: text(body?.question),
    multiSelect: false,
    options: options(body?.options),
    ...(body?.freeTextQuestionId ? { freeTextQuestionId: String(body.freeTextQuestionId) } : {}),
  }];
}

/** The newest prompt still waiting for an answer in a history page, if any. */
export function pendingPrompt(page: any): ChatPrompt | null {
  const items: any[] = Array.isArray(page?.items) ? page.items : [];
  const actionable: string[] | null = Array.isArray(page?.actionablePromptIds) ? page.actionablePromptIds : null;
  const open = items
    .filter((it) => (it?.body?.kind === "question" || it?.body?.kind === "approval") && it.body.resolution?.state === "pending")
    .filter((it) => !actionable || actionable.includes(it.itemId))
    .sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  const it = open[0];
  if (!it) return null;
  const b = it.body;
  if (b.kind === "approval") {
    const lines = [text(b.displayName) || text(b.title), text(b.description), text(b.decisionReason), text(b.detail)]
      .map((l) => l.trim())
      .filter(Boolean);
    return { itemId: it.itemId, revision: it.revision, kind: "approval", title: text(b.title) || "Permission", lines: [...new Set(lines)], options: options(b.options), questions: [] };
  }
  const questions = questionsOf(b);
  return { itemId: it.itemId, revision: it.revision, kind: "question", title: questions[0]?.header ?? "Question", lines: [], options: options(b.options), questions };
}

const answered = (d: ChatDraft, q: ChatQuestion) => {
  const a = d.answers[q.id];
  return !!a && (a.optionIds.length > 0 || !!a.other?.trim());
};

export function freshDraft(p: ChatPrompt, d?: ChatDraft | null): ChatDraft {
  return d && d.itemId === p.itemId ? d : { itemId: p.itemId, at: 0, answers: {} };
}

/** The prompt as Floe's island shows any menu. Approvals say so, so auto-answer leaves them alone. */
export function chatView(p: ChatPrompt, draft: ChatDraft): ScreenView {
  if (p.kind === "approval") {
    return {
      lines: [`Allow ${p.title}?`, ...p.lines.filter((l) => l !== p.title)],
      options: p.options.map((o, i) => ({ n: i + 1, label: o.label, selected: i === 0, freeText: false, ...(o.description ? { description: o.description } : {}) })),
      numbered: true,
      approval: true,
    };
  }
  const qs = p.questions;
  const at = Math.min(draft.at, qs.length - 1);
  const q = qs[at];
  const mine = draft.answers[q.id];
  const opts: MenuOption[] = q.options.map((o, i) => ({
    n: i + 1,
    label: o.label,
    selected: i === 0,
    freeText: false,
    ...(o.description ? { description: o.description } : {}),
    ...(q.multiSelect ? { checked: mine?.optionIds.includes(o.id) ?? false } : {}),
  }));
  if (q.freeTextQuestionId) opts.push({ n: opts.length + 1, label: FREE_TEXT, selected: false, freeText: true, ...(mine?.other ? { description: mine.other } : {}) });
  const tabs: MenuTab[] | undefined = qs.length > 1 ? qs.map((x, i) => ({ label: x.header ?? `Question ${i + 1}`, done: answered(draft, x) })) : undefined;
  return {
    lines: [...(qs.length > 1 ? [`Question ${at + 1} of ${qs.length}`] : []), ...(q.header && qs.length === 1 ? [q.header] : []), q.question].filter(Boolean),
    options: opts,
    numbered: true,
    question: true,
    ...(q.multiSelect ? { multi: true } : {}),
    ...(tabs ? { tabs, steps: true } : q.multiSelect ? { steps: true } : {}),
  };
}

function submission(p: ChatPrompt, d: ChatDraft): ChatAnswer {
  const qs = p.questions;
  const only = qs.length === 1 ? d.answers[qs[0].id] : undefined;
  // One plain pick: the packed form every host version takes.
  if (only && !qs[0].multiSelect && only.optionIds.length === 1 && !only.other) return { optionId: only.optionIds[0] };
  return {
    answers: qs.map((q) => {
      const a = d.answers[q.id] ?? { optionIds: [] };
      return { questionId: q.id, optionIds: a.optionIds, ...(a.other?.trim() ? { other: a.other } : {}) };
    }),
  };
}

/** After answering the question showing: the next one still open, or done. */
function advance(p: ChatPrompt, d: ChatDraft): { draft: ChatDraft; submit?: ChatAnswer } {
  const qs = p.questions;
  const next = qs.findIndex((q, i) => i > d.at && !answered(d, q));
  const first = qs.findIndex((q) => !answered(d, q));
  if (first < 0) return { draft: d, submit: submission(p, d) };
  return { draft: { ...d, at: next >= 0 ? next : first } };
}

export class ChatInputError extends Error {
  constructor(message: string, public code = "invalid_argument") {
    super(message);
  }
}

/**
 * Apply one thing the island did to the prompt: pick option n, type an answer, or step between
 * questions. Returns the draft to keep, what to send once the prompt is fully answered, and what
 * to tell the user.
 */
export function applyChatInput(
  p: ChatPrompt,
  draft: ChatDraft,
  input: { option?: number; text?: string; step?: "next" | "back" },
): { draft: ChatDraft; submit?: ChatAnswer; said: string } {
  if (p.kind === "approval") {
    const o = input.option !== undefined ? p.options[input.option - 1] : undefined;
    if (!o) throw new ChatInputError(input.text ? "This prompt only takes one of its options" : `Option ${input.option} is no longer offered`, input.text ? "menu_only" : "stale_menu");
    return { draft, submit: { optionId: o.id }, said: `picked “${o.label}”` };
  }
  const qs = p.questions;
  const at = Math.min(draft.at, qs.length - 1);
  const q = qs[at];
  if (input.step === "back") return { draft: { ...draft, at: Math.max(0, at - 1) }, said: "previous question" };
  if (input.step === "next") {
    if (!answered(draft, q)) {
      if (qs.length === 1) throw new ChatInputError("Pick an answer first", "invalid_argument");
      return { draft: { ...draft, at: (at + 1) % qs.length }, said: "next question" };
    }
    const r = advance(p, { ...draft, at });
    return { ...r, said: r.submit ? "submitted the answers" : "next question" };
  }
  const freeN = q.freeTextQuestionId ? q.options.length + 1 : -1;
  const typed = input.text?.trim();
  if (typed !== undefined && typed !== "") {
    if (!q.freeTextQuestionId) throw new ChatInputError("This question only takes one of its options", "menu_only");
    const keep = q.multiSelect ? (draft.answers[q.id]?.optionIds ?? []) : [];
    const d = { ...draft, at, answers: { ...draft.answers, [q.id]: { optionIds: keep, other: typed } } };
    const r = advance(p, d);
    return { ...r, said: r.submit ? `answered “${typed.slice(0, 60)}”` : "next question" };
  }
  if (input.option === undefined) throw new ChatInputError("Nothing to send");
  if (input.option === freeN) throw new ChatInputError("Type the answer, then send it", "needs_text");
  const o = q.options[input.option - 1];
  if (!o) throw new ChatInputError(`Option ${input.option} is no longer offered`, "stale_menu");
  if (q.multiSelect) {
    const cur = draft.answers[q.id] ?? { optionIds: [] };
    const on = cur.optionIds.includes(o.id);
    const optionIds = on ? cur.optionIds.filter((x) => x !== o.id) : [...cur.optionIds, o.id];
    return { draft: { ...draft, at, answers: { ...draft.answers, [q.id]: { ...cur, optionIds } } }, said: `${on ? "unticked" : "ticked"} “${o.label}”` };
  }
  const d = { ...draft, at, answers: { ...draft.answers, [q.id]: { optionIds: [o.id] } } };
  const r = advance(p, d);
  return { ...r, said: `picked “${o.label}”` };
}

// MARK: the wire

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** sha256 of {method, sessionId, fields} in Orca's canonical form. */
export function fingerprint(method: string, sessionId: string, fields: Record<string, unknown>): string {
  return createHash("sha256").update(canonical({ method, sessionId, fields })).digest("hex");
}

export function envelope(sessionId: string, fence: number | null | undefined, method: string, fields: Record<string, unknown>) {
  return {
    sessionId,
    clientOperationId: `${Date.now()}-${randomUUID().replaceAll("-", "")}`,
    // 1.4.259 hosts ignore it (writes name their target); older ones still compare it.
    expectedRuntimeFence: typeof fence === "number" && fence > 0 ? fence : 1,
    payloadFingerprint: fingerprint(method, sessionId, fields),
  };
}

/** The request that answers a prompt. */
export function respondRequest(sessionId: string, fence: number | null | undefined, p: ChatPrompt, answer: ChatAnswer) {
  const kind = p.kind;
  const fields = { itemId: p.itemId, expectedRevision: p.revision, ...answer };
  return {
    method: kind === "approval" ? "agentSession.respondToApproval" : "agentSession.respondToQuestion",
    params: { envelope: envelope(sessionId, fence, `agentSession.respondTo:${kind}`, fields), ...fields },
  };
}

/** A follow-up message, queued behind the turn if the agent is still working. */
export function sendRequest(sessionId: string, fence: number | null | undefined, message: string) {
  const body = { kind: "message", role: "user", blocks: [{ type: "text", text: message.trimEnd() }] };
  const fields = { body, delivery: "queue-if-active" };
  return { method: "agentSession.send", params: { envelope: envelope(sessionId, fence, "agentSession.send", fields), ...fields } };
}

/** The chat's recent turns as screen lines, for the island's look at an agent. */
export function transcript(page: any, max = 14): string[] {
  const items: any[] = Array.isArray(page?.items) ? page.items : [];
  const out: string[] = [];
  for (const it of items) {
    const b = it?.body;
    if (!b) continue;
    if (b.kind === "message" && (b.role === "user" || b.role === "assistant")) {
      const said = (Array.isArray(b.blocks) ? b.blocks : []).filter((x: any) => x?.type === "text").map((x: any) => String(x.text)).join(" ").replace(/\s+/g, " ").trim();
      if (said) out.push(`${b.role === "user" ? "›" : "⏺"} ${said.slice(0, 400)}`);
    } else if (b.kind === "tool-call" && b.name && b.name !== "AskUserQuestion") {
      const input = b.input ?? {};
      const what = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? "";
      out.push(`  ${b.name}${what ? `(${String(what).split("\n")[0].slice(0, 120)})` : ""}${b.state === "failed" ? " ✗" : ""}`);
    } else if (b.kind === "status" && b.tone === "error" && b.text) {
      out.push(`  ⚠ ${String(b.text).slice(0, 200)}`);
    }
  }
  return out.slice(-max);
}
