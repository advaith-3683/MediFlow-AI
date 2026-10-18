"use strict";
const fs = require("node:fs");
const { validateConfig, preflight, SafetyError, markerCollection } = require("./safety.cjs");

async function main() {
  const args = process.argv.slice(2);
  const checking = args.includes("--check-config");
  const confirmed = args.includes("--confirm-disposable");
  const index = args.indexOf("--config");
  if (index < 0 || !args[index + 1] || (!checking && !confirmed)) throw new SafetyError("EXPLICIT_CONFIG_AND_CONFIRMATION_REQUIRED");
  if (args.some((arg, position) => position !== index + 1 && !["--config", "--check-config", "--confirm-disposable"].includes(arg))) throw new SafetyError("INVALID_ARGUMENTS");
  let raw;
  try { raw = JSON.parse(fs.readFileSync(args[index + 1], "utf8")); }
  catch { throw new SafetyError("TEST_CONFIG_UNREADABLE"); }
  const config = validateConfig(raw, !checking);
  if (checking) { console.log("Configuration valid. No connection attempted; no integration tests run."); return; }

  // Deliberately do not import server.js or dotenv, or read any URI environment
  // variable. A separate Mongoose instance owns each test-only connection.
  const mongoose = require("mongoose");
  const rs = new mongoose.Mongoose(); const standalone = new mongoose.Mongoose();
  const appName = `mediflow-tx-${config.fixtureId}`;
  const options = { autoCreate: false, autoIndex: false, bufferCommands: false,
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, timeoutMS: 5000,
    monitorCommands: true, maxPoolSize: 12, appName };
  try {
    await rs.connect(config.rs.uri, options);
    await standalone.connect(config.standalone.uri, { ...options, appName: `${appName}-standalone` });
    // Reads only until every configuration, topology and marker check succeeds.
    await preflight(rs, config, config.rs);
    await preflight(standalone, config, config.standalone);
    // Atomically consume the one-use markers so two runners cannot both pass
    // preflight and then interfere with each other's failpoints or fixtures.
    for (const instance of [rs, standalone]) {
      const claim = await instance.connection.db.collection(markerCollection).updateOne(
        { _id: "provisioned", fixtureId: config.fixtureId, state: "ready" },
        { $set: { state: "claimed" } },
      );
      if (claim.matchedCount !== 1) throw new SafetyError("DISPOSABLE_ALREADY_CLAIMED");
    }
    console.log("Both disposable database identities verified. Starting real integration scenarios.");
    const { runScenarios } = require("./suite.cjs");
    const result = await runScenarios({ rs, standalone, config, appName, options });
    console.log(`Real integration scenarios: ${result.passed} passed; ${result.failed} failed.`);
    if (result.failed) process.exitCode = 1;
  } finally {
    await Promise.allSettled([rs.disconnect(), standalone.disconnect()]);
  }
}

main().catch((error) => {
  // Driver/server errors can contain connection details or fixture values.
  // Never print their message, stack, command payload, URI or full object.
  const safeCode = error instanceof SafetyError ? error.code : "INTEGRATION_ABORTED";
  console.error(`Transaction integration stopped: ${safeCode}. No integration success is claimed.`);
  process.exitCode = 1;
});
