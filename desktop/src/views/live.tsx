// What's happening now across every host: needs-you first, then working, then recently done.

import { Icon, OrcaGlyph } from "../icons";
import {
  agentMood,
  agents,
  ago,
  answer,
  answering,
  expandedAgent,
  focusInOrca,
  hosts,
  isRemote,
  kindName,
  liveAgents,
  promptLines,
  screens,
  select,
  snapshot,
  step,
  target,
} from "../store";
import type { Agent, ScreenView } from "../types";
import { ActionButton, Md, MoodIndicator, Spinner } from "./parts";
import { StepTimeline } from "./timeline";

export function LiveView() {
  const live = liveAgents.value;
  if (!live.length) {
    const s = snapshot.value;
    return (
      <div class="empty">
        <span style={{ color: "var(--dim)" }}>
          <OrcaGlyph size={26} />
        </span>
        <div class="empty-title">{s?.online === false ? (s?.headline ?? "Orca is offline") : "All quiet across your hosts"}</div>
        <div class="empty-sub">
          {agents.value.length} agents idle on {hosts.value.filter((h) => h.counts.agents > 0).length} hosts. Browse them in Hosts, or ask Orca to start something.
        </div>
      </div>
    );
  }
  return (
    <div class="scroll pad">
      {live.map((a) => (
        <AgentCard key={a.id} agent={a} />
      ))}
    </div>
  );
}

export function AgentCard({ agent: a, showPlace = true }: { agent: Agent; showPlace?: boolean }) {
  const mood = agentMood(a);
  const open = a.attention != null || expandedAgent.value === a.id;
  const t = target.value;
  const targeted = t.kind === "agent" && t.id === a.id;
  const working = a.state === "working";
  return (
    <div class={`card agent ${a.attention != null ? "attention" : ""} ${targeted ? "targeted" : ""}`}>
      <div class="row gap7">
        <MoodIndicator mood={mood} size={12} />
        {showPlace && isRemote(a) && <span class="host-name">{a.hostName}</span>}
        {showPlace && <span class="ws-name">{a.workspace}</span>}
        <span class="kind">{kindName(a)}</span>
        <span class="spacer clickable" onClick={() => select(a)} />
        <span class="ago">{ago(a.since)}</span>
        <button class="bare" title="Show in Orca" onClick={() => focusInOrca(a)}>
          <Icon name="open" size={11} />
        </button>
      </div>
      <div class="agent-title clickable" style={{ WebkitLineClamp: open ? 3 : 1 }} onClick={() => select(a)}>
        {a.title}
      </div>
      {a.detail && a.attention != null && <div class="attention-detail">{a.detail}</div>}
      {a.steps.length > 0 && (working || a.attention != null || open) ? (
        <StepTimeline steps={a.steps} live={working || a.attention != null} attention={a.attention != null} maxSteps={open ? 8 : 4} />
      ) : working && a.detail ? (
        <div class="mono dim one">{a.detail}</div>
      ) : null}
      {a.progress != null && (
        <div class="progress">
          <i style={{ width: `${Math.max(0, Math.min(100, a.progress))}%` }} />
        </div>
      )}
      {!open && !working && a.attention == null && a.lastMessage && <Md text={a.lastMessage} class="dim clamp2" />}
      {open && <DetailBody agent={a} />}
    </div>
  );
}

function DetailBody({ agent: a }: { agent: Agent }) {
  const screen = screens.value[a.id];
  if (!screen) {
    return (
      <>
        {a.attention != null && (
          <div class="row gap6 dim small-text">
            <Spinner size={12} color="rgba(255,255,255,.7)" />
            Reading the agent's screen…
          </div>
        )}
        {a.attention == null && a.lastMessage && <Md text={a.lastMessage} class="last-message" />}
      </>
    );
  }
  const shown = screen.options.length ? promptLines(screen) : screen.lines;
  const rows = screen.options.length > 0 && (screen.multi === true || screen.options.some((o) => o.description));
  return (
    <>
      {shown.length > 0 && <pre class="screen">{shown.slice(-14).join("\n")}</pre>}
      {screen.tabs && screen.tabs.length > 0 && <QuestionTabs screen={screen} />}
      {rows ? <OptionList agent={a} screen={screen} /> : screen.options.length > 0 ? <OptionCapsules agent={a} screen={screen} /> : null}
      {screen.options.length > 0 && screen.steps === true && <StepButtons agent={a} screen={screen} />}
      {a.attention == null && a.lastMessage && <Md text={a.lastMessage} class="last-message" />}
    </>
  );
}

function OptionCapsules({ agent: a, screen }: { agent: Agent; screen: ScreenView }) {
  const sending = answering.value[a.id];
  return (
    <div class="flow">
      {screen.options.map((o) => {
        const mine = sending === o.n;
        return (
          <button
            key={o.n}
            class={`capsule ${o.selected ? "selected" : ""} ${mine ? "mine" : ""}`}
            disabled={sending !== undefined}
            style={{ opacity: sending !== undefined && !mine ? 0.4 : 1 }}
            onClick={() => answer(a, o)}
          >
            <span class="num">{mine ? <Spinner size={10} width={1.6} color="rgba(0,0,0,.7)" /> : o.n}</span>
            <span>{o.freeText ? `✎ ${o.label}` : o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Options as rows with their descriptions; pick-any ones are checkboxes that stay up. */
function OptionList({ agent: a, screen }: { agent: Agent; screen: ScreenView }) {
  const sending = answering.value[a.id];
  return (
    <div class="option-list">
      {screen.options.map((o) => {
        const mine = sending === o.n;
        const box = o.checked != null;
        return (
          <button
            key={o.n}
            class={`option-row ${o.checked ? "checked" : ""}`}
            disabled={sending !== undefined}
            style={{ opacity: sending !== undefined && !mine ? 0.5 : 1 }}
            title={box ? "Tick or untick" : "Pick this"}
            onClick={() => answer(a, o)}
          >
            <span class="option-mark">
              {mine ? (
                <Spinner size={12} width={1.6} color="rgba(255,255,255,.85)" />
              ) : box ? (
                <Icon name={o.checked ? "checkSquare" : "square"} size={14} style={{ color: o.checked ? "var(--green)" : "rgba(255,255,255,.6)" }} />
              ) : (
                <span class={`num ${o.selected ? "selected" : ""}`}>{o.n}</span>
              )}
            </span>
            <span class="option-text">
              <span class="option-label">{o.freeText ? `✎ ${o.label}` : o.label}</span>
              {o.description && <span class="option-desc">{o.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionTabs({ screen }: { screen: ScreenView }) {
  return (
    <div class="flow tight">
      {screen.tabs!.map((t) => (
        <span key={t.label} class="qtab">
          <Icon
            name={t.label === "Submit" ? "plane" : t.done ? "checkSquare" : "square"}
            size={10}
            style={{ color: t.done && t.label !== "Submit" ? "var(--green)" : "rgba(255,255,255,.6)" }}
          />
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** Back / Next between questions. Next is the way on from a pick-any question. */
function StepButtons({ agent: a, screen }: { agent: Agent; screen: ScreenView }) {
  const busy = answering.value[a.id] !== undefined;
  return (
    <div class="row gap6" style={{ opacity: busy ? 0.6 : 1 }}>
      {screen.tabs && screen.tabs.length > 0 && <ActionButton title="Back" icon="left" disabled={busy} onClick={() => step(a, "back")} />}
      <ActionButton title={screen.multi ? "Next" : "Skip"} icon="right" prominent={!!screen.multi} disabled={busy} onClick={() => step(a, "next")} />
    </div>
  );
}
