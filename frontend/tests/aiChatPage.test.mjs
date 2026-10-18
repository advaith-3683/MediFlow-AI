import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { build } from "vite";
import react from "@vitejs/plugin-react";

// Compile the real page and its real provider into one test entry. No .env,
// application server, database, Gemini request, or JSX-source stub is used.
const frontend = fileURLToPath(new URL("..", import.meta.url));
let dom, output, createRoot, AIChatPage, I18nProvider, LanguageSelect;
const savedGlobals = new Map();
const originalNodeEnv = process.env.NODE_ENV;
before(async () => {
  process.env.NODE_ENV = "development"; // Use React's development StrictMode effect replay.
  const temporary = path.join(frontend, "node_modules", ".tmp");
  await mkdir(temporary, { recursive: true });
  output = await mkdtemp(path.join(temporary, "chat-effects-"));
  await build({
    root: frontend, configFile: false, envDir: false, logLevel: "silent",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("https://backend.example.test") },
    plugins: [react(), {
      name: "actual-chat-test-entry",
      resolveId(id) { if (id === "virtual:chat-test") return "\0chat-test"; },
      load(id) { if (id === "\0chat-test") return 'export {default as AIChatPage} from "/src/pages/patient/AIChatPage.tsx"; export {I18nProvider,LanguageSelect} from "/src/i18n/I18nContext.tsx";'; },
    }],
    build: { ssr: true, outDir: output, emptyOutDir: false, rollupOptions: { input: "virtual:chat-test", output: { entryFileNames: "chat-entry.mjs" } } },
  });
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "localStorage"]) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  savedGlobals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ AIChatPage, I18nProvider, LanguageSelect } = await import(pathToFileURL(path.join(output, "chat-entry.mjs")).href));
});
after(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  dom?.window.close();
  for (const [name, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  if (output) await rm(output, { recursive: true, force: true }); // Only this test's mkdtemp output.
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const reply = text => new Response(JSON.stringify({ reply: text }), { headers: { "content-type": "application/json" } });
const mount = async t => {
  localStorage.clear();
  const errors = []; let scrolls = 0;
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  t.mock.method(globalThis, "fetch", async () => assert.fail("No real network requests allowed"));
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value() { scrolls++; return Promise.resolve(); } });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); let mounted = true;
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); container.remove(); assert.deepEqual(errors, [], "React must not report invalid cleanup or stale updates"); });
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(I18nProvider, null, React.createElement(LanguageSelect), React.createElement(AIChatPage)))));
  const type = async text => {
    const input = container.querySelector("textarea");
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(input, text); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  const send = async (twice = false) => {
    await act(async () => { const button = container.querySelector('[aria-label="Send message"]'); button.click(); if (twice) button.click(); });
  };
  return { container, unmount, type, send, errors, scrolls: () => scrolls };
};

test("StrictMode mounts and unmounts the actual AIChatPage with Promise-returning scrolling", async t => {
  const h = await mount(t);
  assert.ok(h.scrolls() >= 2, "StrictMode must replay the effect");
  await h.unmount(); assert.deepEqual(h.errors, []);
});
test("chat submits once despite rapid duplicate clicks and displays the provider reply", async t => {
  const h = await mount(t), request = deferred(); let calls = 0;
  t.mock.method(globalThis, "fetch", (_url, options) => { calls++; assert.equal(JSON.parse(options.body).language, "English"); return request.promise; });
  await h.type("Synthetic appointment preparation question"); await h.send(true); assert.equal(calls, 1);
  await act(async () => request.resolve(reply("Synthetic educational answer")));
  assert.match(h.container.textContent, /Synthetic educational answer/); await h.unmount();
});
test("unmount aborts pending chat and ignores a late response even when transport ignores abort", async t => {
  const h = await mount(t), request = deferred(); let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => { signal = options.signal; return request.promise; });
  await h.type("Synthetic concern"); await h.send(); await h.unmount(); assert.equal(signal.aborted, true);
  await act(async () => request.resolve(reply("Late response must be ignored"))); assert.equal(h.container.textContent, "");
});
test("language changes cancel older work and stale replies cannot replace the current response", async t => {
  const h = await mount(t), first = deferred(), second = deferred(), calls = [];
  t.mock.method(globalThis, "fetch", (_url, options) => { calls.push(options); return calls.length === 1 ? first.promise : second.promise; });
  await h.type("Synthetic first question"); await h.send();
  await act(async () => { const select = h.container.querySelector("select"); select.value = "hi"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.equal(calls[0].signal.aborted, true);
  await h.type("Synthetic second question"); await h.send(); assert.equal(JSON.parse(calls[1].body).language, "Hindi");
  await act(async () => second.resolve(reply("Current response")));
  await act(async () => first.resolve(reply("Stale response")));
  assert.match(h.container.textContent, /Current response/); assert.doesNotMatch(h.container.textContent, /Stale response/);
});
test("request rejection is handled and clears loading so another message can be sent", async t => {
  const h = await mount(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Synthetic provider outage"); });
  await h.type("Synthetic question"); await h.send(); assert.match(h.container.querySelector('[role="alert"]').textContent, /Synthetic provider outage/);
  await h.type("Synthetic retry"); assert.equal(h.container.querySelector('[aria-label="Send message"]').disabled, false);
});
test("a rejected pending request after unmount and rejected scrolling are both handled", async t => {
  const h = await mount(t), request = deferred();
  dom.window.HTMLElement.prototype.scrollIntoView = () => Promise.reject(new Error("Synthetic scrolling unavailable"));
  t.mock.method(globalThis, "fetch", () => request.promise);
  await h.type("Synthetic question"); await h.send(); await h.unmount();
  await act(async () => request.reject(new Error("Late synthetic failure")));
});
