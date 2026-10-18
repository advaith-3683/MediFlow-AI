"use strict";

class SafetyError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireSafe = (condition, code) => { if (!condition) throw new SafetyError(code); };
const markerCollection = "_mediflow_transaction_fixture";

// Pure validation. No dotenv, environment URI fallback, DNS lookup or connection.
function validateConfig(config, confirmed = false) {
  requireSafe(config && config.version === 1, "INVALID_CONFIG_VERSION");
  requireSafe(/^[a-f0-9]{32}$/.test(config.fixtureId || ""), "INVALID_FIXTURE_ID");
  requireSafe(config.expectedReplicaSet === "mediflow_tx_rs", "INVALID_REPLICA_SET");
  requireSafe(config.enableFailpoints === true, "FAILPOINT_CONSENT_REQUIRED");
  const expectedNames = ["rs", "standalone"].map((kind) => `mf_tx_disposable_${config.fixtureId}_${kind}`);
  requireSafe(Array.isArray(config.allowedDatabases) && config.allowedDatabases.length === 2 &&
    expectedNames.every((name) => config.allowedDatabases.includes(name)), "INVALID_DATABASE_ALLOWLIST");
  const result = { fixtureId: config.fixtureId, expectedReplicaSet: config.expectedReplicaSet };
  for (const [kind, port] of [["rs", "27117"], ["standalone", "27118"]]) {
    const entry = config[kind];
    requireSafe(entry && typeof entry.uri === "string", "MISSING_TEST_URI");
    let uri;
    try { uri = new URL(entry.uri); } catch { throw new SafetyError("INVALID_TEST_URI"); }
    requireSafe(uri.protocol === "mongodb:" && uri.hostname === "127.0.0.1" && uri.port === port, "UNSAFE_TEST_ENDPOINT");
    requireSafe(!uri.username && !uri.password && !uri.hash, "CREDENTIALS_OR_FRAGMENT_NOT_ALLOWED");
    requireSafe(uri.pathname === `/${entry.database}` && entry.database === `mf_tx_disposable_${config.fixtureId}_${kind}` &&
      config.allowedDatabases.includes(entry.database), "DATABASE_NOT_ALLOWLISTED");
    const expectedOptions = kind === "rs" ? { directConnection: "true", replicaSet: config.expectedReplicaSet } : { directConnection: "true" };
    requireSafe([...uri.searchParams].length === Object.keys(expectedOptions).length &&
      Object.entries(expectedOptions).every(([key, value]) => uri.searchParams.get(key) === value), "UNSAFE_URI_OPTIONS");
    // Retain only the validated URI, never production/development configuration.
    result[kind] = { uri: entry.uri, database: entry.database, kind };
  }
  if (confirmed) requireSafe(config.confirmedDisposable === true, "DISPOSABLE_CONFIRMATION_REQUIRED");
  return result;
}

function validateHello(hello, kind, expectedSet) {
  requireSafe(hello && hello.isWritablePrimary === true && hello.msg !== "isdbgrid", "UNEXPECTED_TOPOLOGY");
  if (kind === "rs") {
    requireSafe(hello.setName === expectedSet && Array.isArray(hello.hosts) && hello.hosts.length === 1 &&
      ["localhost:27117", "127.0.0.1:27117"].includes(hello.hosts[0]), "UNEXPECTED_REPLICA_SET");
  } else requireSafe(!hello.setName && !hello.hosts, "EXPECTED_STANDALONE");
}

function validateProvisioning(config, entry, collections, markers) {
  requireSafe(collections.length === 1 && collections[0] === markerCollection, "DATABASE_NOT_PRISTINE");
  requireSafe(markers.length === 1, "INVALID_PROVISIONING_MARKER");
  const marker = markers[0];
  requireSafe(marker._id === "provisioned" && marker.state === "ready" && marker.purpose === "mediflow-transaction-integration-only" &&
    marker.fixtureId === config.fixtureId && marker.database === entry.database && marker.kind === entry.kind,
  "PROVISIONING_MARKER_MISMATCH");
}

async function preflight(instance, config, entry) {
  const database = instance.connection.db;
  requireSafe(database.databaseName === entry.database, "CONNECTED_DATABASE_MISMATCH");
  validateHello(await database.admin().command({ hello: 1 }), entry.kind, config.expectedReplicaSet);
  const version = await database.admin().command({ buildInfo: 1 });
  requireSafe(version.versionArray?.[0] === 8, "EXPECTED_MONGODB_8");
  const collections = (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name);
  // Read only the marker collection after the topology checks. No model is
  // compiled/index created until BOTH connections pass all preflight checks.
  const markers = collections.includes(markerCollection)
    ? await database.collection(markerCollection).find({}).limit(2).toArray() : [];
  validateProvisioning(config, entry, collections, markers);
  if (entry.kind === "rs") {
    const parameters = await database.admin().command({ getParameter: 1, enableTestCommands: 1 });
    requireSafe(parameters.enableTestCommands === true || parameters.enableTestCommands === 1, "TEST_COMMANDS_NOT_ENABLED");
  }
}

module.exports = { SafetyError, validateConfig, validateHello, validateProvisioning, preflight, markerCollection };
