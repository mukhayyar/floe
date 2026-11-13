// Hosts tab: the gathering, then a drill-down with breadcrumbs: host › project › worktree, where
// the worktree page holds its agents and terminals with big, obvious actions.

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../icons";
import {
  agent,
  agentMood,
  ago,
  beginLaunch,
  beginTerminal,
  focusTerminal,
  focusWorkspace,
  host,
  hostMood,
  hostNav,
  launchable,
  newTerminal,
  openTerminal,
  pop,
  project,
  projectFilter,
  push,
  target,
  terminals,
  termScreens,
  toggleTerminal,
  workspace,
} from "../store";
import type { Agent, HostNav, HostView, ProjectView, TerminalInfo, WorkspaceView } from "../types";
import { GatheringView } from "./gathering";
import { AgentCard } from "./live";
import { ActionButton, AgentDots, MoodIndicator, Pebble, SectionTitle, Spinner, Tag, zoneTint } from "./parts";
import { SageAvatar } from "./sage";

export function HostsView() {
  const nav = hostNav.value;
  const last = nav[nav.length - 1];
  return (
    <div class="col fill">
      {nav.length > 0 && <Breadcrumbs />}
      <div class="fill slide-in" key={nav.length}>
        {!last ? (
          <GatheringView />
        ) : last.kind === "host" ? (
          <HostDetail hostId={last.host} />
        ) : last.kind === "project" ? (
          <ProjectDetail hostId={last.host} projectKey={last.project} />
        ) : (
          <WorkspaceDetail hostId={last.host} projectKey={last.project} workspaceKey={last.workspace} />
        )}
      </div>
    </div>
  );
}

function crumbTitle(n: HostNav) {
  switch (n.kind) {
    case "host":
      return host(n.host)?.name ?? "Host";
    case "project":
      return project(n.host, n.project)?.name ?? "Project";
    case "workspace":
      return workspace(n.host, n.project, n.workspace)?.name ?? "Worktree";
  }
}

function Breadcrumbs() {
  const nav = hostNav.value;
  const crumb = (text: string, index: number, last: boolean) => (
    <button key={index} class={`crumb ${last ? "last" : ""}`} onClick={() => !last && pop(index)}>
      {text}
    </button>
  );
  return (
    <div class="breadcrumbs">
      <button class="back" onClick={() => pop()}>
        <Icon name="left" size={11} />
      </button>
      <div class="crumbs">
        {crumb("Gathering", 0, false)}
        {nav.map((n, i) => (
          <Fragment key={i}>
            <Icon name="right" size={9} class="dim" />
            {crumb(crumbTitle(n), i + 1, i === nav.length - 1)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function kindLabel(h: HostView) {
  const kind = h.kind === "local" ? "this computer" : h.kind === "environment" ? "Orca server" : "SSH";
  return h.online ? kind : `${kind} · asleep`;
}

function Gone({ text }: { text: string }) {
  return (
    <div class="empty">
      <div class="dim">{text}</div>
      <ActionButton title="Back to the gathering" icon="left" onClick={() => pop(0)} />
    </div>
  );
}

function HostDetail({ hostId }: { hostId: string }) {
  const h = host(hostId);
  if (!h) return <Gone text="That host is no longer in Orca" />;
  const q = projectFilter.value.toLowerCase();
  const projects = h.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.workspaces.some((w) => w.name.toLowerCase().includes(q)));
  const [a, b] = zoneTint(h.id);
  return (
    <div class="scroll pad">
      <div class="host-hero" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
        <SageAvatar id={h.id} mood={hostMood(h)} size={92} />
        <div class="col gap3">
          <div class="h1">{h.name}</div>
          <div class="dim small-text">{kindLabel(h)}</div>
          <div class="small-text soft">
            {h.projects.length} projects · {h.counts.workspaces} worktrees · {h.counts.agents} agents
          </div>
          <div class="row gap6 badges">
            {h.counts.attention > 0 && (
              <span style={{ color: "var(--orange)" }}>
                <Icon name="alert" size={10} /> {h.counts.attention} need you
              </span>
            )}
            {h.counts.working > 0 && (
              <span style={{ color: "var(--blue)" }}>
                <Spinner size={9} width={1.4} /> {h.counts.working} working
              </span>
            )}
          </div>
        </div>
      </div>
      {h.projects.length > 5 && (
        <label class="filter">
          <Icon name="search" size={11} class="dim" />
          <input
            placeholder="Filter projects and worktrees"
            value={projectFilter.value}
            onInput={(e) => (projectFilter.value = (e.target as HTMLInputElement).value)}
          />
        </label>
      )}
      {!h.online && !h.projects.length && (
        <div class="soft small-text pad-y">
          {h.error === "disconnected"
            ? `Not connected. Connect ${h.name} from Orca's host menu and its projects appear here.`
            : `Unreachable right now (${h.error ?? "offline"}). Floe keeps checking.`}
        </div>
      )}
      {projects.map((p) => (
        <ProjectRow key={p.key} host={h} project={p} />
      ))}
    </div>
  );
}

function ProjectRow({ host: h, project: p }: { host: HostView; project: ProjectView }) {
  const list = p.workspaces.flatMap((w) => w.agentIds).map(agent).filter(Boolean) as Agent[];
  const working = list.filter((a) => a.state === "working").length;
  const attention = list.filter((a) => a.attention != null).length;
  const bits = [`${p.workspaces.length} worktree${p.workspaces.length === 1 ? "" : "s"}`];
  if (attention) bits.push(`${attention} need you`);
  if (working) bits.push(`${working} working`);
  if (list.length && !working && !attention) bits.push(`${list.length} agent${list.length === 1 ? "" : "s"} idle`);
  return (
    <button class="project-row" onClick={() => push({ kind: "project", host: h.id, project: p.key })}>
      <Pebble name={p.name} width={38} glow={attention ? "var(--orange)" : working ? "var(--blue)" : null} />
      <span class="col gap2 grow">
        <span class="title one">{p.name}</span>
        <span class="dim tiny one">{bits.join(" · ")}</span>
      </span>
      <AgentDots agents={list} />
      <Icon name="right" size={10} class="dim" />
    </button>
  );
}

function ProjectDetail({ hostId, projectKey }: { hostId: string; projectKey: string }) {
  const h = host(hostId);
  const p = project(hostId, projectKey);
  if (!h || !p) return <Gone text="That project is no longer in Orca" />;
  return (
    <div class="scroll pad">
      <div class="row gap10">
        <Pebble name={p.name} width={44} />
        <div class="col gap2">
          <div class="h2">{p.name}</div>
          <div class="dim small-text">
            {p.workspaces.length} worktrees on {h.name}
          </div>
        </div>
      </div>
      {p.workspaces.map((w) => (
        <WorkspaceCard key={w.key} host={h} project={p} ws={w} />
      ))}
    </div>
  );
}

function WorkspaceCard({ host: h, project: p, ws }: { host: HostView; project: ProjectView; ws: WorkspaceView }) {
  const list = ws.agentIds.map(agent).filter(Boolean) as Agent[];
  const open = () => push({ kind: "workspace", host: h.id, project: p.key, workspace: ws.key });
  return (
    <div class="card clickable" onClick={open}>
      <div class="row gap7">
        <i class="dot" style={{ background: ws.status === "inactive" ? "rgba(255,255,255,.25)" : "var(--green)" }} />
        <span class="title one">{ws.name}</span>
        {ws.isMain && <Tag text="main" />}
        {ws.branch && ws.branch !== ws.name && <span class="mono dim tiny one">{ws.branch}</span>}
        <span class="spacer" />
        {ws.liveTerminals > 0 && (
          <span class="dim tiny">
            <Icon name="terminal" size={10} /> {ws.liveTerminals}
          </span>
        )}
        <AgentDots agents={list} />
      </div>
      {list.slice(0, 3).map((a) => (
        <div key={a.id} class="row gap6">
          <MoodIndicator mood={agentMood(a)} size={10} />
          <span class="soft tiny one grow">{a.title}</span>
          {a.state === "working" && a.steps.length > 0 && <span class="tiny" style={{ color: "var(--blue)", fontWeight: 600 }}>{a.steps[a.steps.length - 1].tool ?? ""}</span>}
        </div>
      ))}
      <div class="row gap6 wrap">
        <ActionButton title="Open" icon="open" onClick={() => focusWorkspace(ws)} />
        <ActionButton title="Terminals" icon="terminal" prominent onClick={open} />
        <LaunchControl ws={ws} projectName={p.name} host={h} />
      </div>
    </div>
  );
}

function WorkspaceDetail({ hostId, projectKey, workspaceKey }: { hostId: string; projectKey: string; workspaceKey: string }) {
  const h = host(hostId);
  const p = project(hostId, projectKey);
  const ws = workspace(hostId, projectKey, workspaceKey);
  if (!h || !p || !ws) return <Gone text="That worktree is no longer in Orca" />;
  const list = ws.agentIds.map(agent).filter(Boolean) as Agent[];
  const where = h.kind === "local" ? `${p.name}/${ws.name}` : `${p.name}/${ws.name} on ${h.name}`;
  const terms = terminals.value[ws.key];
  return (
    <div class="scroll pad">
      <div class="col gap3">
        <div class="row gap6">
          <span class="h2">{ws.name}</span>
          {ws.isMain && <Tag text="main" />}
          <Tag text={h.name} />
        </div>
        {ws.branch && <span class="mono dim tiny">{ws.branch}</span>}
        <span class="mono faint tiny one middle">{ws.path}</span>
      </div>
      <div class="row gap6 wrap">
        <ActionButton title="Open in Orca" icon="open" onClick={() => focusWorkspace(ws)} />
        <ActionButton title="New terminal" icon="plusRect" onClick={() => newTerminal(ws)} />
        <LaunchControl ws={ws} projectName={p.name} host={h} />
      </div>
      {list.length > 0 && (
        <>
          <SectionTitle text="Agents" count={list.length} />
          {list.map((a) => (
            <AgentCard key={a.id} agent={a} showPlace={false} />
          ))}
        </>
      )}
      <SectionTitle text="Terminals" count={terms?.length ?? 0} />
      {terms ? (
        terms.length ? (
          terms.map((t) => <TerminalRow key={t.id} terminal={t} where={where} />)
        ) : (
          <div class="dim small-text">No terminals open. Start one with New terminal.</div>
        )
      ) : (
        <div class="row gap6 dim small-text">
          <Spinner size={12} color="rgba(255,255,255,.7)" /> Loading terminals…
        </div>
      )}
    </div>
  );
}

function TerminalRow({ terminal: t, where }: { terminal: TerminalInfo; where: string }) {
  const open = openTerminal.value === t.id;
  const tg = target.value;
  const typing = (tg.kind === "terminal" && tg.id === t.id) || (tg.kind === "agent" && !!t.agentId && tg.id === t.agentId);
  const lines = termScreens.value[t.id];
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [lines, open]);
  return (
    <div class={`card terminal ${typing ? "typing" : ""}`}>
      <div class="row gap7">
        <Icon name={t.agentType ? "sparkle" : "terminal"} size={11} style={{ color: t.agentType ? "var(--purple)" : "rgba(255,255,255,.75)" }} />
        <span class="medium one">{t.title}</span>
        {t.main && <Tag text="main" />}
        {t.agentType && <Tag text={t.agentLabel || t.agentType} />}
        <span class="spacer" />
        {t.lastOutputAt != null && <span class="dim tiny">{ago(t.lastOutputAt)}</span>}
      </div>
      {t.preview && !open && <div class="mono faint tiny one">{t.preview}</div>}
      {open && (
        <div class="screen-box">
          {lines ? (
            <pre class="screen tall" ref={pre}>
              {lines.slice(-18).join("\n")}
            </pre>
          ) : (
            <div class="center pad-y">
              <Spinner size={14} color="rgba(255,255,255,.7)" />
            </div>
          )}
        </div>
      )}
      <div class="row gap6 wrap">
        <ActionButton title={t.agentId ? "Message" : "Type command"} icon="keyboard" prominent={typing} onClick={() => beginTerminal(t, where)} />
        <ActionButton title={open ? "Hide screen" : "Peek screen"} icon={open ? "eyeOff" : "eye"} onClick={() => toggleTerminal(t)} />
        <ActionButton title="Show in Orca" icon="open" onClick={() => focusTerminal(t)} />
      </div>
    </div>
  );
}

/** Start an agent: the host's Orca default as a button, every other installed harness in a menu. */
function LaunchControl({ ws, projectName, host: h }: { ws: WorkspaceView; projectName: string; host: HostView }) {
  const kinds = launchable(h);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  return (
    <div class="launch" ref={ref} onClick={(e) => e.stopPropagation()}>
      <ActionButton title={kinds[0].label} icon="plus" onClick={() => beginLaunch(ws, projectName, h, kinds[0].id)} />
      {kinds.length > 1 && (
        <button class="action chevron" title={`More agents: ${kinds.slice(1).map((k) => k.label).join(", ")}`} onClick={() => setMenu(!menu)}>
          <Icon name="down" size={9} />
        </button>
      )}
      {menu && (
        <div class="menu">
          <div class="menu-title">Start an agent on {h.name}</div>
          {kinds.map((k) => (
            <button
              key={k.id}
              class="menu-item"
              onClick={() => {
                setMenu(false);
                beginLaunch(ws, projectName, h, k.id);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
