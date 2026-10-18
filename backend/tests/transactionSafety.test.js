const test = require("node:test");
const assert = require("node:assert/strict");
const { validateConfig, validateHello, validateProvisioning, markerCollection } = require("./transactions/safety.cjs");
const config = () => {
  const fixtureId = "a".repeat(32);
  const rs = `mf_tx_disposable_${fixtureId}_rs`;
  const standalone = `mf_tx_disposable_${fixtureId}_standalone`;
  return { version: 1, fixtureId, expectedReplicaSet: "mediflow_tx_rs", confirmedDisposable: true, enableFailpoints: true,
    allowedDatabases: [rs, standalone],
    rs: { database: rs, uri: `mongodb://127.0.0.1:27117/${rs}?directConnection=true&replicaSet=mediflow_tx_rs` },
    standalone: { database: standalone, uri: `mongodb://127.0.0.1:27118/${standalone}?directConnection=true` } };
};
test("valid explicit local allowlist passes without any network operation", () => {
  assert.equal(validateConfig(config(), true).rs.kind, "rs");
});
for (const [label, mutate] of [
  ["missing configuration", () => null],
  ["missing confirmation", (c) => { c.confirmedDisposable = false; return c; }],
  ["Atlas SRV URI", (c) => { c.rs.uri = "mongodb+srv://example.invalid/production"; return c; }],
  ["remote host", (c) => { c.rs.uri = c.rs.uri.replace("127.0.0.1", "example.invalid"); return c; }],
  ["usual development port", (c) => { c.rs.uri = c.rs.uri.replace("27117", "27017"); return c; }],
  ["credentials", (c) => { c.rs.uri = c.rs.uri.replace("//", "//synthetic:synthetic@"); return c; }],
  ["database mismatch", (c) => { c.rs.uri = c.rs.uri.replace(c.rs.database, "production"); return c; }],
  ["missing allowlist", (c) => { c.allowedDatabases = []; return c; }],
  ["extra allowlisted database", (c) => { c.allowedDatabases.push("development"); return c; }],
  ["extra URI options", (c) => { c.rs.uri += "&proxyHost=example.invalid"; return c; }],
  ["repeated URI options", (c) => { c.rs.uri += "&directConnection=true"; return c; }],
  ["wrong fixture nonce", (c) => { c.fixtureId = "invalid"; return c; }],
  ["missing failpoint consent", (c) => { c.enableFailpoints = false; return c; }],
]) {
  test(`rejects ${label} with a fixed credential-free error`, () => {
    assert.throws(() => validateConfig(mutate(config()), true), (error) => /^[A-Z_]+$/.test(error.message));
  });
}
test("topology rejects wrong replica sets, remote members, secondary and mongos", () => {
  const hello = { isWritablePrimary: true, setName: "mediflow_tx_rs", hosts: ["localhost:27117"] };
  validateHello(hello, "rs", "mediflow_tx_rs");
  for (const change of [{ setName: "production" }, { hosts: ["example.invalid:27117"] }, { isWritablePrimary: false }, { msg: "isdbgrid" }]) {
    assert.throws(() => validateHello({ ...hello, ...change }, "rs", "mediflow_tx_rs"));
  }
  assert.throws(() => validateHello(hello, "standalone", "mediflow_tx_rs"));
});
test("marker must independently match fixture, database and server kind", () => {
  const c = validateConfig(config(), true);
  const marker = { _id: "provisioned", state: "ready", purpose: "mediflow-transaction-integration-only", fixtureId: c.fixtureId, database: c.rs.database, kind: "rs" };
  validateProvisioning(c, c.rs, [markerCollection], [marker]);
  for (const change of [{ fixtureId: "b".repeat(32) }, { database: "production" }, { kind: "standalone" }, { state: "claimed" }]) {
    assert.throws(() => validateProvisioning(c, c.rs, [markerCollection], [{ ...marker, ...change }]));
  }
  assert.throws(() => validateProvisioning(c, c.rs, [markerCollection, "users"], [marker]));
  assert.throws(() => validateProvisioning(c, c.rs, [], []));
});

test("CLI without explicit confirmation refuses before loading the integration suite", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const result = spawnSync(process.execPath, [path.join(__dirname, "transactions", "run.cjs")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXPLICIT_CONFIG_AND_CONFIRMATION_REQUIRED/);
  assert.equal(result.stdout, "");
});
