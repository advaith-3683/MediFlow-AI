// Snapshot/write-conflict simulation only. No MongoDB connection or dotenv.
const assert = require("node:assert/strict");
const schemas = Object.fromEntries(["User", "Appointment", "Consultation", "Prescription", "AuditLog", "Notification"].map(name => [name, require(`../../models/${name}`)]));
const clone = value => JSON.parse(JSON.stringify(value));
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(item => matches(record, item));
  if (key === "$and") return value.every(item => matches(record, item));
  if (key === "$nor") return !value.some(item => matches(record, item));
  const actual = record[key];
  if (value === null) return actual == null;
  if (value && typeof value === "object" && !(value instanceof Date) && !value._bsontype) {
    if ("$regex" in value) return new RegExp(value.$regex, value.$options).test(actual || "");
    return Object.entries(value).every(([op, rhs]) => op === "$ne" ? String(actual) !== String(rhs) : op === "$exists" ? (actual !== undefined) === rhs : op === "$in" ? rhs.some(v => String(v) === String(actual)) : op === "$gt" ? new Date(actual) > new Date(rhs) : false);
  }
  return String(actual) === String(value);
});
const harness = () => {
  const state = Object.fromEntries(Object.keys(schemas).map(name => [name, []]));
  const revisions = new Map();
  const stats = { retries: 0, writes: [], unsupported: false, failAt: null, unknownCommit: false };
  const assertSession = session => assert.ok(session?.work, "every database operation must participate in a transaction");
  const touch = (name, id, session) => { assertSession(session); session.writes.add(`${name}:${id}`); stats.writes.push(name); if (stats.failAt === name) throw new Error(`Injected ${name} failure`); };
  const document = (name, values) => {
    const doc = new schemas[name](values);
    doc.save = async ({ session } = {}) => {
      await doc.validate();
      if (doc.__v === undefined) doc.__v = 0;
      touch(name, doc._id, session);
      const row = clone(doc.toObject()); const table = session.work[name];
      const index = table.findIndex(item => String(item._id) === String(doc._id));
      if (index < 0) table.push(row); else table[index] = row;
      return doc;
    };
    doc.populate = async options => { for (const option of options) { assertSession(option.options.session); assert.equal(option.ordered, true); } return doc; };
    return doc;
  };
  const query = (name, filter, many = false) => {
    let session;
    return { select() { return this; }, session(value) { session = value; return this; }, then(resolve, reject) {
      return Promise.resolve().then(() => {
        assertSession(session);
        const rows = session.work[name].filter(row => matches(row, filter));
        return many ? rows.map(row => document(name, row)) : rows[0] ? document(name, rows[0]) : null;
      }).then(resolve, reject);
    } };
  };
  const db = {};
  for (const name of Object.keys(schemas)) {
    db[name] = function (values) { return document(name, values); };
    db[name].findOne = filter => query(name, filter);
    db[name].findById = id => query(name, { _id: String(id) });
    db[name].find = filter => query(name, filter, true);
    db[name].findOneAndUpdate = async (filter, changes, { session } = {}) => {
      assertSession(session);
      const row = session.work[name].find(item => matches(item, filter));
      if (!row) return null;
      touch(name, row._id, session); Object.assign(row, clone(changes.$set || {}));
      for (const [key, inc] of Object.entries(changes.$inc || {})) row[key] = (row[key] || 0) + inc;
      return document(name, row);
    };
  }
  db.mongoose = { async startSession() {
    return { work: null, writes: null, async endSession() {}, async withTransaction(operation) {
      if (stats.unsupported) throw Object.assign(new Error("unsupported"), { code: 20 });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        this.work = clone(state); this.writes = new Set(); const before = new Map(revisions);
        const result = await operation();
        if ([...this.writes].some(key => revisions.get(key) !== before.get(key))) { stats.retries += 1; continue; }
        for (const key of this.writes) {
          const [name, id] = key.split(":"); const row = this.work[name].find(item => String(item._id) === id);
          const index = state[name].findIndex(item => String(item._id) === id);
          if (index < 0) state[name].push(clone(row)); else state[name][index] = clone(row);
          revisions.set(key, (revisions.get(key) || 0) + 1);
        }
        if (stats.unknownCommit) { stats.unknownCommit = false; throw Object.assign(new Error("uncertain"), { hasErrorLabel: label => label === "UnknownTransactionCommitResult" }); }
        return result;
      }
      throw new Error("Mock retry exhaustion");
    } };
  } };
  const add = (name, values) => { const doc = new schemas[name](values); doc.__v = 0; state[name].push(clone(doc.toObject())); return doc; };
  return { db, state, stats, add };
};
module.exports = { harness };
