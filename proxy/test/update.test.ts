import { expect, test } from "bun:test";
import { compare, VERSION } from "../src/update";

test("versions compare by number, not by text", () => {
  expect(compare("0.4.10", "0.4.9")).toBe(1);
  expect(compare("v0.5.0", "0.4.1")).toBe(1);
  expect(compare("0.4.1", "0.4.1")).toBe(0);
  expect(compare("0.4.0", "v0.4.1")).toBe(-1);
  expect(compare("1.0", "0.99.99")).toBe(1);
});

test("the proxy knows its own version", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("every part of Floe carries the same version (the update check relies on the proxy's)", async () => {
  const root = `${import.meta.dir}/../..`;
  const read = (p: string) => Bun.file(`${root}/${p}`).text();
  const desktop = JSON.parse(await read("desktop/package.json")).version;
  const tauri = JSON.parse(await read("desktop/src-tauri/tauri.conf.json")).version;
  const cargo = (await read("desktop/src-tauri/Cargo.toml")).match(/^version = "([^"]+)"/m)?.[1];
  const mac = (await read("app/Info.plist")).match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)</)?.[1];
  expect({ desktop, tauri, cargo, mac }).toEqual({ desktop: VERSION, tauri: VERSION, cargo: VERSION, mac: VERSION });
});

test("a git checkout never runs the installer on itself", async () => {
  const { installNow, update, SOURCE_CHECKOUT } = await import("../src/update");
  expect(SOURCE_CHECKOUT).toBe(true); // tests run from the repo
  Object.assign(update, { newer: true, latest: "99.0.0" });
  const r = await installNow("you");
  expect(r.ok).toBe(false);
  expect(r.message).toContain("git pull");
  expect(update.updating).toBe(false);
});
