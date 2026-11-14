// Settings Floe's own Settings tab changes at runtime. config.json is for you to edit by hand;
// this file is written by the proxy.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config";

const PATH = join(CONFIG_DIR, "prefs.json");

export interface Prefs {
  /** Deliver messages that another session sent and Claude held for your approval. */
  autoDeliver: boolean;
  /** Answer agents' questions: the recommended option, a finished form's Submit. */
  autoAnswer: boolean;
  /** Install a newer Floe by itself once no agent is waiting on you (on unless you turn it off). */
  autoUpdate: boolean;
  /** With auto-answer: a question that recommends nothing is answered "go with what you'd recommend". */
  letAgentChoose: boolean;
}

function read(): Partial<Prefs> {
  try {
    return JSON.parse(readFileSync(PATH, "utf8"));
  } catch {
    return {};
  }
}

const saved = read();
export const prefs: Prefs = {
  autoDeliver: saved.autoDeliver === true,
  // one switch used to do both: keep answering for whoever had it on
  autoAnswer: typeof saved.autoAnswer === "boolean" ? saved.autoAnswer : saved.autoDeliver === true,
  autoUpdate: saved.autoUpdate !== false,
  letAgentChoose: saved.letAgentChoose !== false,
};

export function setPrefs(p: Partial<Prefs>): Prefs {
  if (typeof p.autoDeliver === "boolean") prefs.autoDeliver = p.autoDeliver;
  if (typeof p.autoAnswer === "boolean") prefs.autoAnswer = p.autoAnswer;
  if (typeof p.autoUpdate === "boolean") prefs.autoUpdate = p.autoUpdate;
  if (typeof p.letAgentChoose === "boolean") prefs.letAgentChoose = p.letAgentChoose;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PATH, JSON.stringify(prefs, null, 2) + "\n");
  return prefs;
}
