import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveApiBase } from "../src/api/deploymentConfig.ts";
test("development default and explicit production HTTPS origin are normalized", () => {
  assert.equal(resolveApiBase(undefined, false), "http://localhost:5000");
  assert.equal(resolveApiBase(" https://backend.example.test/ ", true), "https://backend.example.test");
});
test("production never silently falls back to localhost or insecure API origins", () => {
  for (const value of [undefined, "", "http://backend.example.test", "https://localhost", "https://127.0.0.1", "https://[::1]"]) assert.throws(() => resolveApiBase(value, true));
});
test("API configuration rejects credentials, API path duplication, queries and fragments without exposing values", () => {
  for (const value of ["https://user:private@backend.example.test", "https://backend.example.test/api", "https://backend.example.test?secret=private", "https://backend.example.test/#private", "//backend.example.test"]) {
    assert.throws(() => resolveApiBase(value, true), error => !error.message.includes("private"));
  }
});
test("same-origin API mode requires explicit opt-in", () => assert.equal(resolveApiBase("/", true), ""));

test("Vercel frontend configuration preserves SPA deep links without embedding secrets or backend endpoints", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config, {
    $schema: "https://openapi.vercel.sh/vercel.json",
    rewrites: [{ source: "/(.*)", destination: "/index.html" }],
  });
  const route = new RegExp(`^${config.rewrites[0].source}$`);
  for (const path of ["/patient/appointments", "/doctor/appointments/synthetic-id", "/admin/dashboard", "/notifications", "/login"]) assert.ok(route.test(path));
});
