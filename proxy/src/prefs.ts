// Settings Floe's own Settings tab changes at runtime. config.json is for you to edit by hand;
// this file is written by the proxy.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config";

const PATH = join(CONFIG_DIR, "prefs.json");

export interface Prefs {
  /** Deliver held cross-session messages and pick an agent's recommended option without asking. */
  autoDeliver: boolean;
}

function read(): Partial<Prefs> {
  try {
    return JSON.parse(readFileSync(PATH, "utf8"));
  } catch {
    return {};
  }
}

export const prefs: Prefs = { autoDeliver: read().autoDeliver === true };

export function setPrefs(p: Partial<Prefs>): Prefs {
  if (typeof p.autoDeliver === "boolean") prefs.autoDeliver = p.autoDeliver;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PATH, JSON.stringify(prefs, null, 2) + "\n");
  return prefs;
}
