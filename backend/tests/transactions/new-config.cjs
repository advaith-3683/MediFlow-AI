"use strict";
// Creates configuration only. Never starts a process or connects to MongoDB.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fixtureId = crypto.randomBytes(16).toString("hex");
const rsDatabase = `mf_tx_disposable_${fixtureId}_rs`;
const standaloneDatabase = `mf_tx_disposable_${fixtureId}_standalone`;
const config = { version: 1, fixtureId, confirmedDisposable: false, enableFailpoints: true,
  expectedReplicaSet: "mediflow_tx_rs", allowedDatabases: [rsDatabase, standaloneDatabase],
  rs: { database: rsDatabase, uri: `mongodb://127.0.0.1:27117/${rsDatabase}?directConnection=true&replicaSet=mediflow_tx_rs` },
  standalone: { database: standaloneDatabase, uri: `mongodb://127.0.0.1:27118/${standaloneDatabase}?directConnection=true` } };
try {
  fs.writeFileSync(path.join(__dirname, "disposable.local.json"), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log("Test-only configuration created with confirmation disabled. No database connection attempted.");
} catch {
  console.error("Test-only configuration not created. Existing files are never overwritten.");
  process.exitCode = 1;
}
