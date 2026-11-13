// The Ask tab: a headless Claude Code session (the proxy's "brain") that can read your repos
// and drive Orca on any host.

import { useEffect, useRef } from "preact/hooks";
import { ask, chat, newChat, openChatInOrca, stopAsking, streaming } from "../store";
import type { ChatMessage, Step } from "../types";
import { Md, MoodIndicator, SmallButton } from "./parts";
import { StepTimeline } from "./timeline";

const SUGGESTIONS = [
  "What are my agents doing on every host?",
  "Which agent needs me, and what is it asking?",
  "What changed in my repos today?",
];

export function ChatView() {
  const list = chat.value;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [list]);
  return (
    <div class="col fill">
      <div class="row gap8 chat-head">
        <span class="label">Talking to Orca</span>
        <span class="spacer" />
        {streaming.value && <SmallButton title="Stop" icon="stop" onClick={stopAsking} />}
        <SmallButton title="Open in Orca" icon="open" onClick={openChatInOrca} />
        <SmallButton title="New" icon="plus" onClick={newChat} />
      </div>
      {!list.length ? (
        <div class="col gap8 pad16">
          <div class="soft">Ask about any host, project or agent, or tell Orca to start work.</div>
          {SUGGESTIONS.map((s) => (
            <button key={s} class="suggestion" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div class="scroll chat-list">
          {list.map((m, i) => (
            <MessageRow key={m.id} message={m} live={streaming.value && i === list.length - 1} />
          ))}
          <div ref={end} style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
}

/** The brain's tool calls as timeline steps ("Bash: git log -1" → tool Bash, text git log -1). */
function stepsOf(m: ChatMessage, live: boolean): Step[] {
  const tools = m.tools ?? [];
  const times = m.toolAt ?? [];
  const answering = live && m.text.length > 0;
  return tools.map((t, i) => {
    const cut = t.indexOf(":");
    const tool = cut >= 0 ? t.slice(0, cut).trim() : t.trim();
    const text = cut >= 0 ? t.slice(cut + 1).trim() : "";
    const last = i === tools.length - 1;
    return { kind: "tool", tool, text, at: times[i] ?? m.at, done: !(live && last && !answering) };
  });
}

function MessageRow({ message: m, live }: { message: ChatMessage; live: boolean }) {
  if (m.role === "user") {
    return (
      <div class="msg-user">
        <div class="bubble">{m.text}</div>
      </div>
    );
  }
  const steps = stepsOf(m, live);
  return (
    <div class="col gap6">
      {steps.length > 0 && <StepTimeline steps={steps} live={live} maxSteps={live ? 6 : 3} />}
      {!m.text && live ? (
        <div class="row gap6 dim">
          <MoodIndicator mood="thinking" size={12} />
          {steps.length ? "working…" : "thinking…"}
        </div>
      ) : (
        <Md text={m.text + (live ? " ▍" : "")} class="msg-assistant" />
      )}
    </div>
  );
}
