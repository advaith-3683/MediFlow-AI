const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const User = require("../models/User");
const { deploymentConfig, corsOptions, healthResponse, assertTransactionTopology, verifyDatabaseReadiness } = require("../services/deploymentConfig");
const { errorHandler } = require("../middleware/errorHandler");
const { createMedicalRecordRouter } = require("../routes/medicalRecords");
const { medicalFixture, png } = require("./helpers/medicalFixture.cjs");
const production = () => ({ NODE_ENV: "production", MONGO_URI: "mongodb+srv://synthetic.example.test/demo", JWT_SECRET: "unit-test-random-like-secret-longer-than-32-bytes", CORS_ORIGIN: "https://frontend.example.test/", MEDICAL_UPLOADS_ENABLED: "false" });
test("production accepts explicit free-demo configuration without Gemini/email or a disk", () => {
  const config = deploymentConfig(production()); assert.deepEqual(config.origins, ["https://frontend.example.test"]); assert.equal(config.trustProxyHops, 0); assert.equal(config.port, 5000);
});
for (const [key, value] of [["JWT_SECRET", "short-private"], ["JWT_SECRET", "replace-with-a-long-random-secret"], ["CORS_ORIGIN", ""], ["CORS_ORIGIN", "*"], ["CORS_ORIGIN", "http://frontend.example.test"], ["CORS_ORIGIN", "https://private@frontend.example.test/path"], ["PORT", "0"], ["PORT", "5000.5"], ["TRUST_PROXY_HOPS", "true"], ["TRUST_PROXY_HOPS", "6"], ["MEDICAL_UPLOADS_ENABLED", "typo"]]) test(`production rejects invalid ${key}: ${value.slice(0, 8)}`, () => {
  assert.throws(() => deploymentConfig({ ...production(), [key]: value }), error => !error.message.includes("private"));
});
test("production uploads require an absolute explicitly configured storage root", () => {
  assert.throws(() => deploymentConfig({ ...production(), MEDICAL_UPLOADS_ENABLED: "true" }), /UPLOADS_DIRECTORY/);
  assert.throws(() => deploymentConfig({ ...production(), MEDICAL_UPLOADS_ENABLED: "true", UPLOADS_DIRECTORY: "uploads" }), /UPLOADS_DIRECTORY/);
  assert.equal(deploymentConfig({ ...production(), MEDICAL_UPLOADS_ENABLED: "true", UPLOADS_DIRECTORY: require("node:os").tmpdir() }).production, true);
});
test("development defaults remain compatible and required fields fail before startup", () => {
  assert.deepEqual(deploymentConfig({ MONGO_URI: "mongodb://127.0.0.1:27017/unused", JWT_SECRET: "synthetic" }).origins, ["http://localhost:5173"]);
  for (const key of ["MONGO_URI", "JWT_SECRET"]) assert.throws(() => deploymentConfig({ ...production(), [key]: "" }));
});
test("production topology check rejects standalone but accepts replica sets and mongos with sessions", () => {
  for (const hello of [{}, { logicalSessionTimeoutMinutes: 30 }, { setName: "synthetic" }]) assert.throws(() => assertTransactionTopology(hello));
  assert.doesNotThrow(() => assertTransactionTopology({ setName: "synthetic", logicalSessionTimeoutMinutes: 30 }));
  assert.doesNotThrow(() => assertTransactionTopology({ msg: "isdbgrid", logicalSessionTimeoutMinutes: 30 }));
});
test("database readiness waits for required indexes and propagates failures before HTTP startup", async () => {
  const initialized = [];
  const instance = { connection: { db: { admin: () => ({ command: async () => ({ setName: "synthetic", logicalSessionTimeoutMinutes: 30 }) }) } }, model: name => ({ init: async () => { initialized.push(name); if (name === "Prescription") throw new Error("synthetic duplicate index failure"); } }) };
  await assert.rejects(verifyDatabaseReadiness(instance, true), /duplicate index failure/);
  assert.deepEqual(initialized, ["User", "Appointment", "Consultation", "Prescription", "MedicalRecord", "AuditLog", "Notification"]);
  initialized.length = 0;
  instance.connection.db.admin = () => ({ command: async () => ({ logicalSessionTimeoutMinutes: 30 }) });
  await assert.rejects(verifyDatabaseReadiness(instance, true), /topology/); assert.deepEqual(initialized, []);
});
const listen = async (t, app) => {
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
};
test("health returns 503 on database loss; CORS preflight permits exact origin and rejects others", async t => {
  const connection = { readyState: 1 }, app = express();
  app.use(cors(corsOptions(deploymentConfig(production()).origins)));
  app.get("/api/health", (_req, res) => healthResponse(connection, res)); app.use(errorHandler);
  t.mock.method(console, "error", () => {});
  const url = await listen(t, app); let response = await fetch(url + "/api/health", { headers: { origin: "https://frontend.example.test" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("access-control-allow-origin"), "https://frontend.example.test"); assert.equal(response.headers.get("cache-control"), "no-store");
  connection.readyState = 0; response = await fetch(url + "/api/health"); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: "unavailable", database: "unavailable" });
  const options = { method: "OPTIONS", headers: { origin: "https://frontend.example.test", "access-control-request-method": "PATCH", "access-control-request-headers": "Authorization,Content-Type" } };
  assert.equal((await fetch(url + "/api/health", options)).status, 204);
  response = await fetch(url + "/api/health", { headers: { origin: "https://untrusted.example.test" } }); assert.equal(response.status, 403); assert.doesNotMatch(JSON.stringify(await response.json()), /untrusted/);
});
test("trusted proxy hop count uses nearest forwarded address; default ignores spoofed header", async t => {
  for (const hops of [0, 1]) {
    const app = express(); app.set("trust proxy", deploymentConfig({ ...production(), TRUST_PROXY_HOPS: String(hops) }).trustProxyHops);
    app.get("/ip", (req, res) => res.json({ ip: req.ip })); const url = await listen(t, app);
    const body = await (await fetch(url + "/ip", { headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" } })).json();
    assert.equal(body.ip, hops ? "192.0.2.2" : "127.0.0.1");
  }
});
test("disabled upload mode advertises restriction, rejects binary files before writes, and keeps text records", async t => {
  const h = await medicalFixture(); t.after(h.cleanup);
  const oldUploads = process.env.MEDICAL_UPLOADS_ENABLED, oldSecret = process.env.JWT_SECRET;
  process.env.MEDICAL_UPLOADS_ENABLED = "false"; process.env.JWT_SECRET = "synthetic-deployment-http-secret";
  t.after(() => { for (const [key, value] of [["MEDICAL_UPLOADS_ENABLED", oldUploads], ["JWT_SECRET", oldSecret]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const id = "507f1f77bcf86cd799439011";
  t.mock.method(User, "findById", () => ({ select: async () => ({ _id: id, role: "patient", accountStatus: "active" }) }));
  t.mock.method(console, "error", () => {});
  const app = express(); app.use(express.json()); app.use("/records", createMedicalRecordRouter({ Model: h.Model, store: h.store })); app.use(errorHandler);
  const base = await listen(t, app), headers = { authorization: `Bearer ${jwt.sign({ userId: id }, process.env.JWT_SECRET)}` };
  assert.equal((await (await fetch(base + "/records/capabilities", { headers })).json()).fileUploadsEnabled, false);
  const body = new FormData(); body.set("title", "Synthetic"); body.set("file", new Blob([png], { type: "image/png" }), "synthetic.png");
  assert.equal((await fetch(base + "/records", { method: "POST", headers, body })).status, 503); assert.equal(h.rows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
  const response = await fetch(base + "/records", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ title: "Synthetic text record" }) });
  assert.equal(response.status, 201); assert.equal(h.rows.length, 1); assert.equal(h.rows[0].fileUrl, "");
});
