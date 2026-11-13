import { render } from "preact";
import { App, startApp } from "./app";
import { native } from "./native";
import * as store from "./store";
import { start } from "./store";
import "./styles.css";

window.addEventListener("error", (e) => native.log(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => native.log(`unhandled: ${String((e as PromiseRejectionEvent).reason)}`));

// Dev builds only: poke the store from devtools or test scripts.
if (import.meta.env.DEV) (window as unknown as { __floe: typeof store }).__floe = store;

startApp();
render(<App />, document.getElementById("app")!);
start().then(() => native.log(`ui up (${window.innerWidth}x${window.innerHeight}, zoom ${store.zoom.value}, ${document.querySelectorAll(".island").length} island)`));
