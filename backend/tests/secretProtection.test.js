const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { errorHandler } = require("../middleware/errorHandler");
const { deliver } = require("../services/deliveryService");

// Only ignore files are read. All Git operations target a fresh temporary repo;
// no application .env, credentials, Git index, database or provider is accessed.
for (const scope of ["root", "backend", "frontend"]) test(`${scope} ignore rules protect secrets and retain environment examples`, () => {
  const root = path.resolve(__dirname, "../..");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mediflow-ignore-"));
  try {
    const source = scope === "root" ? path.join(root, ".gitignore") : path.join(root, scope, ".gitignore");
    fs.copyFileSync(source, path.join(repo, ".gitignore"));
    if (scope === "root") for (const directory of ["backend", "frontend"]) {
      fs.mkdirSync(path.join(repo, directory));
      fs.copyFileSync(path.join(root, directory, ".gitignore"), path.join(repo, directory, ".gitignore"));
    }
    const init = spawnSync("git", ["init", "--quiet", repo], { encoding: "utf8" });
    assert.equal(init.status, 0, "temporary Git repository must initialize");
    const prefixes = scope === "root" ? ["", "backend/", "frontend/"] : [""];
    const names = [".env", ".env.production", ".env.local", "private.key", "certificate.pem", "bundle.p12", "bundle.pfx", "store.jks", "cert.crt", ".npmrc", "credentials.json", "service-account-test.json", "node_modules/test.js", "dist/index.js", "debug.log", "capture.har"];
    if (scope !== "frontend") names.push("uploads/record.pdf", "dump/records.bson", "disposable.local.json", "id_ed25519");
    const ignored = prefixes.flatMap(prefix => names.map(name => prefix + name));
    const trackable = prefixes.flatMap(prefix => [".env.example", ".env.production.example", "src/main.js", "package-lock.json"].map(name => prefix + name));
    const result = spawnSync("git", ["-C", repo, "check-ignore", "--no-index", "--stdin"], { input: [...ignored, ...trackable].join("\n") + "\n", encoding: "utf8" });
    assert.equal(result.status, 0);
    const matched = new Set(result.stdout.trim().split(/\r?\n/));
    for (const name of ignored) assert.ok(matched.has(name), `${scope}: ${name} must be ignored`);
    for (const name of trackable) assert.equal(matched.has(name), false, `${scope}: ${name} must remain trackable`);
  } finally {
    // repo is the exact path created above by mkdtemp; never an application path.
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
test("central error logging excludes external error fields and medical payloads", t => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  const error = Object.assign(new Error("synthetic private medical details"), { name: "synthetic-private-name", code: "synthetic-private-code", config: { headers: { Authorization: "synthetic-secret" } } });
  const response = { status() { return this; }, json() {} };
  errorHandler(error, {}, response, () => {});
  assert.deepEqual(logged, [["Request failed"]]);
});
test("development delivery logging excludes recipient and template data", async t => {
  const logged = [];
  const originalMode = process.env.NODE_ENV;
  t.mock.method(console, "info", (...args) => logged.push(args));
  try {
    process.env.NODE_ENV = "development";
    assert.deepEqual(await deliver({ channel: "email", recipient: "synthetic-private@example.test", template: "synthetic medical detail" }), { delivered: false, adapter: "local" });
    assert.deepEqual(logged, [["Development delivery not sent"]]);
  } finally { if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode; }
});
test("medical record query failures keep raw errors and patient data out of logs", async t => {
  const MedicalRecord = require("../models/MedicalRecord");
  const router = require("../routes/medicalRecords");
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  const failure = new Error("synthetic private patient details and connection credentials");
  t.mock.method(MedicalRecord, "find", () => ({ sort: async () => { throw failure; } }));
  t.mock.method(MedicalRecord, "findOne", async () => { throw failure; });
  t.mock.method(MedicalRecord, "create", async () => { throw failure; });
  const response = () => ({ statusCode: 0, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } });
  // Exercise handlers with mocked model failures; never connect or delete data.
  for (const [routePath, method, expected] of [["/my", "get", "Fetch medical records failed"], ["/:id", "delete", "Delete medical record failed"]]) {
    const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route;
    const res = response();
    await route.stack[0].handle({ user: { id: "synthetic-patient" }, params: { id: "507f1f77bcf86cd799439011" } }, res);
    assert.equal(res.statusCode, method === "delete" ? 503 : 500); assert.deepEqual(logged.pop(), [expected]);
  }
  const create = router.stack.find(layer => layer.route?.path === "/" && layer.route.methods.post).route;
  let forwarded;
  await create.stack.at(-1).handle({ user: { id: "synthetic-patient" }, body: { title: "Synthetic record" } }, response(), error => { forwarded = error; });
  assert.equal(forwarded, failure); assert.deepEqual(logged.pop(), ["Create medical record failed"]);
});
