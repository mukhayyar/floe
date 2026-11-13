// The input along the bottom, and who hears it: Orca, an agent, a worktree, a terminal, or a
// new agent being started. The current pick is pinned up front; everything else scrolls after it.

import { useEffect, useRef } from "preact/hooks";
import { Icon } from "../icons";
import {
  agent,
  agentMood,
  agentName,
  bestAgent,
  defaultKind,
  expandedAgent,
  focusToken,
  input,
  kindName,
  liveAgents,
  place,
  send,
  sending,
  streaming,
  tab,
  target,
  targetAgent,
  toast,
} from "../store";
import { moodColor, Spinner } from "./parts";

function placeholder(): string {
  const t = target.value;
  if (t.kind === "launch") return `Task for a new ${agentName(t.agent)} in ${t.label}…`;
  if (t.kind === "terminal") return `Command to run in ${t.label}…`;
  if (t.kind === "workspace") {
    const a = bestAgent(t.key);
    if (a) return a.attention != null ? `Answer ${kindName(a)} in ${t.label}…` : `Message ${kindName(a)} in ${t.label}…`;
    return `Task for a new ${defaultKind(t.key).label} in ${t.label}…`;
  }
  const a = targetAgent.value;
  if (a) return a.attention != null ? `Answer ${place(a)}…` : `Message ${place(a)}…`;
  return "Ask Orca anything…";
}

function pinnedChip(): { title: string; icon: string; color: string } | null {
  const t = target.value;
  switch (t.kind) {
    case "brain":
      return null;
    case "workspace": {
      const a = bestAgent(t.key);
      return { title: t.label, icon: "branch", color: a ? moodColor[agentMood(a)] : "var(--green)" };
    }
    case "agent": {
      const a = agent(t.id);
      return a ? { title: `${a.agentType} · ${place(a)}`, icon: "sparkle", color: moodColor[agentMood(a)] } : null;
    }
    case "terminal":
      return { title: t.label, icon: "terminal", color: "var(--green)" };
    case "launch":
      return { title: `New ${t.agent} · ${t.label}`, icon: "plus", color: "var(--green)" };
  }
}

export function InputBar() {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusToken.value === 0) return;
    const id = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [focusToken.value]);
  // Grow with the text, one to four lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 4 * 18 + 4)}px`;
  }, [input.value]);

  const pin = pinnedChip();
  const t = target.value;
  const busy = sending.value || (streaming.value && t.kind === "brain");
  const others = liveAgents.value.filter((a) => !(t.kind === "agent" && t.id === a.id));
  return (
    <div class="inputbar">
      {toast.value && <div class="toast">{toast.value}</div>}
      <div class="targets">
        {pin && (
          <span class="pinned" style={{ background: pin.color }}>
            <Icon name={pin.icon} size={9} />
            <span class="one middle">{pin.title}</span>
            <button class="bare" title="Talk to Orca instead" onClick={() => (target.value = { kind: "brain" })}>
              <Icon name="x" size={8} />
            </button>
          </span>
        )}
        <div class="chips">
          <button class={`chip ${t.kind === "brain" ? "on" : ""}`} style={t.kind === "brain" ? { background: "var(--purple)" } : undefined} onClick={() => (target.value = { kind: "brain" })}>
            <Icon name="sparkle" size={9} />
            Orca
          </button>
          {others.map((a) => (
            <button
              key={a.id}
              class="chip"
              onClick={() => {
                target.value = { kind: "agent", id: a.id };
                expandedAgent.value = a.id;
                if (tab.value !== "live" && tab.value !== "hosts") tab.value = "live";
              }}
            >
              <i style={{ background: moodColor[agentMood(a)] }} />
              {place(a)}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <textarea
          ref={ref}
          rows={1}
          placeholder={placeholder()}
          value={input.value}
          onInput={(e) => (input.value = (e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy && <Spinner size={14} color="rgba(255,255,255,.75)" />}
        <button class={`send ${input.value.trim() ? "ready" : ""}`} disabled={!input.value.trim()} onClick={send} title="Send">
          <Icon name="send" size={13} />
        </button>
      </div>
    </div>
  );
}
