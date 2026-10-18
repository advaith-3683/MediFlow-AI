// Run manually ONLY inside the newly created dedicated containers in README.md.
// No credentials or application environment are used; existing databases refused.
(() => {
try {
const fixtureId = process.env.MEDIFLOW_TX_FIXTURE_ID;
const kind = process.env.MEDIFLOW_TX_KIND;
if (!/^[a-f0-9]{32}$/.test(fixtureId || "") || !["rs", "standalone"].includes(kind)) throw new Error("INVALID_PROVISIONING_PARAMETERS");
const hello = db.adminCommand({ hello: 1 });
if (!hello.isWritablePrimary || (kind === "rs" ? hello.setName !== "mediflow_tx_rs" : Boolean(hello.setName))) throw new Error("UNEXPECTED_PROVISIONING_TOPOLOGY");
const database = `mf_tx_disposable_${fixtureId}_${kind}`;
const fixtureDatabase = db.getSiblingDB(database);
if (fixtureDatabase.getCollectionNames().length !== 0) throw new Error("PROVISIONING_DATABASE_ALREADY_EXISTS");
fixtureDatabase.getCollection("_mediflow_transaction_fixture").insertOne({
  _id: "provisioned", state: "ready", purpose: "mediflow-transaction-integration-only", fixtureId, database, kind,
});
print("New disposable fixture marker created. No application database accessed.");
} catch {
  print("DISPOSABLE_PROVISIONING_REFUSED. No raw server error logged.");
  quit(1);
}
})();
