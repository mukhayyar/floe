// What an agent is doing, step by step: each tool call (or thing it said) is a node on a rail.
// New steps draw in once (CSS animation on mount); the current one spins with a running timer.

import { Icon, toolIcon } from "../icons";
import { now } from "../store";
import type { Step } from "../types";
import { Spinner } from "./parts";

const stepId = (s: Step) => `${Math.floor(s.at)}|${s.kind}|${s.tool ?? ""}|${s.text.slice(0, 40)}`;

function elapsed(at: number, t: number) {
  const s = Math.max(0, Math.floor((t - at) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

export function StepTimeline({ steps, live, attention = false, maxSteps = 6 }: { steps: Step[]; live: boolean; attention?: boolean; maxSteps?: number }) {
  const shown = steps.slice(-maxSteps);
  const hidden = steps.length - shown.length;
  return (
    <div class="timeline">
      {hidden > 0 && (
        <div class="earlier">
          {hidden} earlier step{hidden === 1 ? "" : "s"}
        </div>
      )}
      {shown.map((s, i) => {
        const last = i === shown.length - 1;
        const active = live && last && !s.done;
        const warn = attention && last;
        const color = warn ? "var(--orange)" : active ? "var(--blue)" : s.kind === "say" ? "rgba(189,148,255,0.8)" : "rgba(255,255,255,0.45)";
        const fresh = Date.now() - s.at < 4000; // only steps that just landed draw themselves in
        return (
          <div key={stepId(s)} class={`step ${i === 0 ? "first" : ""} ${last ? "last" : ""} ${fresh ? "fresh" : ""}`}>
            <div class="rail">
              <span class="node">
                {active ? (
                  <span class="node-active" style={{ background: "rgba(102,173,255,0.18)" }}>
                    <Spinner size={9} width={1.6} color={color} />
                  </span>
                ) : warn ? (
                  <span class="node-warn">!</span>
                ) : s.kind === "say" ? (
                  <span class="node-say" />
                ) : (
                  <span class="node-done">
                    <Icon name="check" size={7} />
                  </span>
                )}
              </span>
            </div>
            <div class="step-text">
              <div class="step-head">
                <Icon name={toolIcon(s.tool, s.kind)} size={10} style={{ color }} />
                <span style={{ color: active || warn ? color : "rgba(255,255,255,0.75)" }}>{s.kind === "say" ? "said" : (s.tool ?? "tool")}</span>
                {active && <span class="elapsed">{elapsed(s.at, now.value)}</span>}
              </div>
              {s.text && (
                <div class={`step-body ${s.kind === "tool" ? "mono" : ""} ${active ? "active" : ""}`} style={{ WebkitLineClamp: active ? 3 : 1 }}>
                  {s.text}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
