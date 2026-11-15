import { describe, expect, test } from "bun:test";
import { applyChatInput, chatSessionId, chatView, fingerprint, freshDraft, pendingPrompt, respondRequest, sendRequest, transcript } from "./chat";
import { autoChoice, LET_AGENT_CHOOSE, whyNot } from "./menu";

// Shapes as Orca 1.4.259's agentSession.history returns them.
const question = (over: any = {}) => ({
  itemId: "orca:claude-prompt%3As%3A1",
  revision: 2,
  sequence: 10,
  body: {
    kind: "question",
    question: "Which colour?",
    options: [{ id: "q1:choice-1", label: "Teal (Recommended)" }, { id: "q1:choice-2", label: "Amber" }],
    freeTextQuestionId: "q1",
    questions: [
      { id: "q1", question: "Which colour?", header: "Colour", multiSelect: false, freeTextQuestionId: "q1",
        options: [{ id: "q1:choice-1", label: "Teal (Recommended)" }, { id: "q1:choice-2", label: "Amber" }] },
      { id: "q2", question: "Which extras?", header: "Extras", multiSelect: true, freeTextQuestionId: "q2",
        options: [{ id: "q2:choice-1", label: "Shadow" }, { id: "q2:choice-2", label: "Icon" }] },
    ],
    resolution: { state: "pending", selectedOptionId: null, resolvedBy: null, resolvedAt: null },
    ...over,
  },
});

const approval = {
  itemId: "orca:claude-approval%3A9",
  revision: 1,
  sequence: 12,
  body: {
    kind: "approval",
    title: "Bash",
    description: "rm -rf build",
    detail: null,
    options: [{ id: "allow", label: "Allow (Recommended)", intent: "allow" }, { id: "deny", label: "Deny", intent: "deny" }],
    resolution: { state: "pending", selectedOptionId: null, resolvedBy: null, resolvedAt: null },
  },
};

describe("chat tabs", () => {
  test("finds the session behind a chat row", () => {
    expect(chatSessionId("structured-agent-session-claude_02c51d33_1e1d:295dca6f")).toBe("claude_02c51d33_1e1d");
    expect(chatSessionId("tab-1:leaf-1")).toBeNull();
  });

  test("reads the open prompt, newest first, only if Orca lists it as actionable", () => {
    const old = { ...question(), itemId: "old", sequence: 3 };
    const done = { ...question({ resolution: { state: "resolved" } }), itemId: "done", sequence: 20 };
    expect(pendingPrompt({ items: [old, question(), done], actionablePromptIds: ["orca:claude-prompt%3As%3A1", "old"] })?.itemId).toBe("orca:claude-prompt%3As%3A1");
    expect(pendingPrompt({ items: [question()], actionablePromptIds: [] })).toBeNull();
    expect(pendingPrompt({ items: [done] })).toBeNull();
  });

  test("a single question with no questions list is its own question q1", () => {
    const p = pendingPrompt({ items: [question({ questions: undefined, freeTextQuestionId: undefined })] })!;
    expect(p.questions.map((q) => q.id)).toEqual(["q1"]);
    const r = applyChatInput(p, freshDraft(p), { option: 2 });
    expect(r.submit).toEqual({ optionId: "q1:choice-2" });
  });

  test("walks a two-question form, ticks boxes, then submits every answer", () => {
    const p = pendingPrompt({ items: [question()] })!;
    let d = freshDraft(p);
    const v1 = chatView(p, d);
    expect(v1.lines).toEqual(["Question 1 of 2", "Which colour?"]);
    expect(v1.options.map((o) => o.label)).toEqual(["Teal (Recommended)", "Amber", "Type something."]);
    expect(v1.options[2].freeText).toBe(true);
    expect(v1.tabs).toEqual([{ label: "Colour", done: false }, { label: "Extras", done: false }]);

    let r = applyChatInput(p, d, { option: 1 });
    expect(r.submit).toBeUndefined();
    d = r.draft;
    const v2 = chatView(p, d);
    expect(v2.multi).toBe(true);
    expect(v2.options.map((o) => o.checked)).toEqual([false, false, undefined]);

    d = applyChatInput(p, d, { option: 1 }).draft;
    d = applyChatInput(p, d, { option: 2 }).draft;
    d = applyChatInput(p, d, { option: 2 }).draft; // untick
    expect(chatView(p, d).options.map((o) => o.checked)).toEqual([true, false, undefined]);
    r = applyChatInput(p, d, { step: "next" });
    expect(r.submit).toEqual({ answers: [{ questionId: "q1", optionIds: ["q1:choice-1"] }, { questionId: "q2", optionIds: ["q2:choice-1"] }] });
  });

  test("a typed answer goes in `other`; picking the free-text row asks for the text", () => {
    const p = pendingPrompt({ items: [question({ questions: undefined })] })!;
    expect(() => applyChatInput(p, freshDraft(p), { option: 3 })).toThrow(/Type the answer/);
    const r = applyChatInput(p, freshDraft(p), { text: "  Burgundy " });
    expect(r.submit).toEqual({ answers: [{ questionId: "q1", optionIds: [], other: "Burgundy" }] });
  });

  test("auto-answer: picks the recommended option, lets the agent choose otherwise, never answers a permission", () => {
    const p = pendingPrompt({ items: [question({ questions: undefined })] })!;
    expect(autoChoice(chatView(p, freshDraft(p)), { answer: true })?.option.label).toBe("Teal (Recommended)");

    const plain = pendingPrompt({ items: [question({ questions: undefined, options: [{ id: "a", label: "Cat" }, { id: "b", label: "Dog" }] })] })!;
    const pick = autoChoice(chatView(plain, freshDraft(plain)), { answer: true, letAgentChoose: true });
    expect(pick?.say).toBe(LET_AGENT_CHOOSE);
    expect(pick?.option.freeText).toBe(true);

    const a = pendingPrompt({ items: [approval] })!;
    const v = chatView(a, freshDraft(a));
    expect(v.approval).toBe(true);
    expect(v.lines[0]).toBe("Allow Bash?");
    expect(autoChoice(v, { answer: true, letAgentChoose: true })).toBeNull();
    expect(whyNot(v, { answer: true })).toBe("a permission or approval prompt");
  });

  test("an approval is answered with the option's id", () => {
    const a = pendingPrompt({ items: [approval] })!;
    const r = applyChatInput(a, freshDraft(a), { option: 2 });
    expect(r.submit).toEqual({ optionId: "deny" });
    const req = respondRequest("s", 3, a, r.submit!);
    expect(req.method).toBe("agentSession.respondToApproval");
    expect(req.params).toMatchObject({ itemId: approval.itemId, expectedRevision: 1, optionId: "deny" });
    expect(req.params.envelope).toMatchObject({ sessionId: "s", expectedRuntimeFence: 3 });
    expect(req.params.envelope.clientOperationId).toMatch(/^\d{13}-[0-9a-f]{32}$/);
    expect(req.params.envelope.payloadFingerprint).toBe(fingerprint("agentSession.respondTo:approval", "s", { itemId: approval.itemId, expectedRevision: 1, optionId: "deny" }));
  });

  test("fingerprints match Orca's own (checked against Orca 1.4.259's structuredAgentSessionPayloadFingerprint)", () => {
    expect(fingerprint("agentSession.respondTo:question", "claude_02c51d33", { itemId: "orca:x%3Ay", expectedRevision: 2, optionId: "q1:choice-2", answers: undefined }))
      .toBe("a5f48c974e36da29ee5238f5047ef7f8a9ff13d49d41a5f61041af922a261cba");
    expect(fingerprint("agentSession.send", "s", { body: { kind: "message", role: "user", blocks: [{ type: "text", text: "hi" }] }, delivery: "queue-if-active" }))
      .toBe("7be7eedb687c77a766a58a111095a3faedb8c724ebcb34604eee5681db7160ed");
    const req = sendRequest("s", null, "hi");
    expect(req.params.envelope.expectedRuntimeFence).toBe(1);
    expect(req.params.envelope.payloadFingerprint).toBe("7be7eedb687c77a766a58a111095a3faedb8c724ebcb34604eee5681db7160ed");
  });

  test("shows a chat's recent turns as screen lines", () => {
    const lines = transcript({ items: [
      { body: { kind: "message", role: "user", blocks: [{ type: "text", text: "Run the tests" }] } },
      { body: { kind: "tool-call", name: "Bash", input: { command: "bun test\nmore" }, state: "completed" } },
      { body: { kind: "message", role: "reasoning", blocks: [{ type: "text", text: "thinking" }] } },
      { body: { kind: "message", role: "assistant", blocks: [{ type: "text", text: "All  33\npass." }] } },
    ] });
    expect(lines).toEqual(["› Run the tests", "  Bash(bun test)", "⏺ All 33 pass."]);
  });
});
