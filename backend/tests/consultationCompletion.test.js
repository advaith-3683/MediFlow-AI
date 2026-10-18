const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const models = Object.fromEntries(["User", "Appointment", "Consultation", "Prescription", "AuditLog", "Notification"].map((name) => [name, require(`../models/${name}`)]));
const { createCompletionService } = require("../services/consultationCompletion");

const doctorId = "507f1f77bcf86cd799439011";
const patientId = "507f1f77bcf86cd799439012";
const appointmentId = "507f1f77bcf86cd799439013";
const otherId = "507f1f77bcf86cd799439014";
const copy = (value) => JSON.parse(JSON.stringify(value));
const payload = () => ({ appointmentVersion: 0,
  consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" },
  prescription: { medications: [{ medicineName: "Medicine", dosage: "1 tablet", frequency: "daily", duration: "3 days" }] },
});

// This fake implements snapshot/commit/abort/retry for application regression
// testing only. Real Mongoose schemas validate documents, but no MongoDB client
// is created and no real transaction guarantees are claimed by these tests.
const harness = () => {
  let state = {
    User: [{ _id: doctorId, role: "doctor", isVerified: true, accountStatus: "active", doctorVerificationStatus: "verified", isDoctorVerified: true }, { _id: patientId, safetyProfile: { allergies: ["Medicine"] } }],
    Appointment: [{ _id: appointmentId, patient: patientId, doctor: doctorId, status: "scheduled", problem: "Concern" }],
    Consultation: [], Prescription: [], AuditLog: [], Notification: [],
  };
  let version = 0;
  const stats = { writes: [], sessions: [], attempts: 0, aborts: 0, commits: 0, failAt: null, duplicateOnce: false, transientOnce: false, unsupported: false, unknownCommit: false };
  const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((entry) => matches(record, entry));
    if (value && typeof value === "object" && "$exists" in value) return (record[key] !== undefined) === value.$exists;
    if (value && typeof value === "object" && "$ne" in value) return record[key] !== value.$ne;
    return String(record[key]) === String(value);
  });
  const deps = {};
  const requireSession = (session) => {
    assert.ok(stats.sessions.includes(session), "every database operation must use this request's session");
    assert.ok(session.work, "operation must be in an active transaction");
  };
  const document = (name, value) => {
    const doc = new models[name](value);
    doc.populate = async (options) => {
      for (const entry of options) {
        requireSession(entry.options.session);
        assert.equal(entry.ordered, true, "population must not parallelize queries inside the transaction");
      }
      return doc;
    };
    doc.save = async ({ session } = {}) => {
      requireSession(session);
      stats.writes.push(name);
      if (stats.failAt === name) throw new Error(`Injected ${name} failure`);
      if (stats.duplicateOnce && name === "Consultation") {
        stats.duplicateOnce = false;
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      }
      if (stats.transientOnce && name === "Prescription") {
        stats.transientOnce = false;
        throw Object.assign(new Error("write conflict"), { transient: true });
      }
      const table = session.work[name];
      const next = copy(doc.toObject());
      const index = table.findIndex((item) => item._id === next._id);
      if (index >= 0) table[index] = next;
      else table.push(next);
      return doc;
    };
    return doc;
  };
  const find = (name, filter) => {
    let session;
    const query = {
      select() { return this; },
      session(value) { session = value; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          requireSession(session);
          const found = session.work[name].find((item) => matches(item, filter));
          return found ? document(name, found) : null;
        }).then(resolve, reject);
      },
    };
    return query;
  };
  for (const name of Object.keys(models)) {
    deps[name] = function (value) { return document(name, value); };
    deps[name].findOne = (filter) => find(name, filter);
    deps[name].findById = (id) => find(name, { _id: String(id) });
  }
  deps.Appointment.findOneAndUpdate = async (filter, update, options) => {
    requireSession(options.session);
    assert.equal(filter.status, "scheduled");
    assert.equal(filter.doctor, doctorId);
    assert.deepEqual(update, { $set: { status: "completed" }, $inc: { __v: 1 } });
    assert.equal(options.new, true);
    assert.equal(options.runValidators, true);
    stats.writes.push("Appointment");
    if (stats.failAt === "Appointment") throw new Error("Injected appointment failure");
    const found = options.session.work.Appointment.find((item) => matches(item, filter));
    if (!found) return null;
    found.status = "completed";
    found.__v = (found.__v || 0) + 1;
    return document("Appointment", found);
  };
  deps.mongoose = { async startSession() {
    const session = {
      async withTransaction(callback, options) {
        assert.deepEqual(options, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        if (stats.unsupported) throw Object.assign(new Error("standalone"), { code: 20 });
        for (let retry = 0; retry < 5; retry += 1) {
          const snapshotVersion = version;
          session.work = copy(state);
          stats.attempts += 1;
          try {
            const result = await callback();
            if (snapshotVersion !== version) { stats.aborts += 1; continue; }
            state = session.work;
            version += 1;
            stats.commits += 1;
            session.work = null;
            if (stats.unknownCommit) throw Object.assign(new Error("commit acknowledgement lost"), { hasErrorLabel: (label) => label === "UnknownTransactionCommitResult" });
            return result;
          } catch (error) {
            stats.aborts += 1;
            session.work = null;
            if (error.transient) continue;
            throw error;
          }
        }
        throw new Error("Fake retry budget exceeded");
      },
      async endSession() { session.ended = true; },
    };
    stats.sessions.push(session);
    return session;
  } };
  return { get state() { return state; }, stats, complete: createCompletionService(deps) };
};
const complete = (h, body = payload(), doctor = doctorId) => h.complete({ appointmentId, doctorId: doctor, body });

test("successful completion atomically persists clinical records, audits and notification", async () => {
  const h = harness();
  const result = await complete(h);
  assert.equal(result.appointment.status, "completed");
  assert.equal(result.consultation.status, "completed");
  assert.equal(result.safetyWarnings[0].type, "allergy-name-match");
  assert.equal(result.consultation.completionRequestHash, undefined);
  assert.equal(h.state.Consultation.length, 1);
  assert.equal(h.state.Prescription.length, 1);
  assert.deepEqual(h.state.AuditLog.map((item) => item.action), ["CONSULTATION_COMPLETED", "APPOINTMENT_COMPLETED", "PRESCRIPTION_CREATED"]);
  assert.equal(h.state.Notification.length, 1);
  assert.ok(h.stats.sessions.every((session) => session.ended));
});
test("approved assigned doctor can complete without verified email", async () => {
  const h = harness(); h.state.User[0].isVerified = false;
  await complete(h); assert.equal(h.state.Appointment[0].status, "completed");
});

test("completion without prescription preserves response shape and emits only relevant events", async () => {
  const h = harness();
  const body = payload(); delete body.prescription;
  const result = await complete(h, body);
  assert.equal(result.prescription, null);
  assert.equal(h.state.Prescription.length, 0);
  assert.equal(h.state.AuditLog.length, 2);
  assert.equal(h.state.Notification[0].link, "/patient/consultations");
});

for (const [name, mutate] of [
  ["incomplete medication", (body) => { body.prescription.medications[0].dosage = ""; }],
  ["excess medications", (body) => { body.prescription.medications = Array(21).fill(body.prescription.medications[0]); }],
  ["overlong notes", (body) => { body.consultation.clinicalNotes = "x".repeat(10001); }],
  ["out-of-range vitals", (body) => { body.consultation.vitals = { pulseBpm: 999 }; }],
  ["invalid vitals", (body) => { body.consultation.vitals = { pulseBpm: "bad" }; }],
  ["missing assessment", (body) => { delete body.consultation.diagnosis; }],
  ["past follow-up date", (body) => { body.prescription.followUpDate = "2000-01-01"; }],
  ["invalid medication object", (body) => { body.prescription.medications = [null]; }],
]) {
  test(`${name} is rejected before any write`, async () => {
    const h = harness(); const before = copy(h.state); const body = payload(); mutate(body);
    await assert.rejects(complete(h, body), (error) => error.status === 400 || error.name === "ValidationError");
    assert.deepEqual(h.state, before);
    assert.equal(h.stats.writes.length, 0);
  });
}

for (const stage of ["Appointment", "Consultation", "Prescription", "AuditLog", "Notification"]) {
  test(`${stage} failure rolls back every staged write and preserves an existing draft`, async () => {
    const h = harness();
    h.state.Consultation.push({ _id: otherId, appointment: appointmentId, patient: patientId, doctor: doctorId, status: "draft", clinicalNotes: "Keep these notes", amendments: [] });
    const before = copy(h.state); h.stats.failAt = stage;
    await assert.rejects(complete(h), /Injected/);
    assert.deepEqual(h.state, before);
    assert.equal(h.stats.commits, 0);
    assert.ok(h.stats.sessions.every((session) => session.ended));
  });
}

test("identical repeats return committed records without duplicate events or overwriting void history", async () => {
  const h = harness(); const first = await complete(h); const writeCount = h.stats.writes.length;
  h.state.Prescription[0].status = "voided"; h.state.Prescription[0].voidReason = "Historical correction";
  const second = await complete(h);
  assert.equal(String(second.consultation._id), String(first.consultation._id));
  assert.equal(second.prescription.status, "voided");
  assert.equal(second.prescription.voidReason, "Historical correction");
  assert.equal(h.stats.writes.length, writeCount);
  assert.equal(h.state.AuditLog.length, 3);
  assert.equal(h.state.Notification.length, 1);
});

test("changed completion payload is a conflict and leaves committed history untouched", async () => {
  const h = harness(); await complete(h); const before = copy(h.state);
  const body = payload(); body.consultation.diagnosis = "Different assessment";
  await assert.rejects(complete(h, body), { status: 409 });
  assert.deepEqual(h.state, before);
});

test("concurrent identical requests converge after mocked transaction retry", async () => {
  const h = harness();
  const results = await Promise.all([complete(h), complete(h)]);
  assert.equal(String(results[0].consultation._id), String(results[1].consultation._id));
  assert.equal(h.state.Consultation.length, 1);
  assert.equal(h.state.Prescription.length, 1);
  assert.equal(h.state.AuditLog.length, 3);
  assert.equal(h.state.Notification.length, 1);
  assert.ok(h.stats.aborts > 0);
});

test("concurrent conflicting payloads cannot overwrite the winning completion", async () => {
  const h = harness(); const changed = payload(); changed.consultation.advice = "Different advice";
  const results = await Promise.allSettled([complete(h), complete(h, changed)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  assert.equal(h.state.Notification.length, 1);
});

test("transient callback retry reloads records and does not duplicate events", async () => {
  const h = harness(); h.stats.transientOnce = true;
  await complete(h);
  assert.equal(h.stats.attempts, 2);
  assert.equal(h.state.Prescription.length, 1);
  assert.equal(h.state.AuditLog.length, 3);
  assert.equal(h.state.Notification.length, 1);
});

test("duplicate-key conflict retries in a fresh session and never deletes records", async () => {
  const h = harness(); h.stats.duplicateOnce = true;
  await complete(h);
  assert.equal(h.stats.sessions.length, 2);
  assert.equal(h.state.Consultation.length, 1);
  assert.equal(h.state.Notification.length, 1);
});

for (const state of ["pending", "rejected", "disabled"]) {
  test(`${state} doctor cannot complete`, async () => {
    const h = harness();
    if (state === "disabled") h.state.User[0].accountStatus = "disabled";
    else { h.state.User[0].doctorVerificationStatus = state; h.state.User[0].isDoctorVerified = false; }
    await assert.rejects(complete(h), { status: 403 });
    assert.equal(h.stats.writes.length, 0);
  });
}
for (const status of ["pending", "rejected"]) test(`completion rejects explicit ${status} despite legacy boolean`, async () => {
  const h = harness(); h.state.User[0].doctorVerificationStatus = status; h.state.User[0].isDoctorVerified = true;
  await assert.rejects(complete(h), { status: 403 }); assert.equal(h.stats.writes.length, 0);
});

test("unrelated approved doctor and inconsistent consultation ownership are rejected", async () => {
  const h = harness(); h.state.Appointment[0].doctor = otherId;
  await assert.rejects(complete(h), { status: 404 });
  h.state.Appointment[0].doctor = doctorId;
  h.state.Consultation.push({ _id: otherId, appointment: appointmentId, patient: patientId, doctor: otherId, status: "draft" });
  await assert.rejects(complete(h), { status: 409 });
  assert.equal(h.stats.writes.length, 0);
});

for (const status of ["completed", "cancelled"]) {
  test(`previously ${status} appointment without an idempotent receipt is not completed`, async () => {
    const h = harness(); h.state.Appointment[0].status = status;
    await assert.rejects(complete(h), { status: 409 });
    assert.equal(h.stats.writes.length, 0);
  });
}

test("existing issued or voided prescription on a scheduled appointment is preserved", async () => {
  for (const status of ["active", "voided"]) {
    const h = harness();
    h.state.Prescription.push({ _id: otherId, appointment: appointmentId, consultation: otherId, doctor: doctorId, patient: patientId, status, voidReason: "Preserve history" });
    const before = copy(h.state);
    await assert.rejects(complete(h), { status: 409 });
    assert.deepEqual(h.state, before);
    assert.equal(h.stats.writes.length, 0);
  }
});

test("omitted clinical notes and amendments survive draft completion", async () => {
  const h = harness();
  h.state.Consultation.push({ _id: otherId, appointment: appointmentId, doctor: doctorId, patient: patientId, status: "draft", clinicalNotes: "Private notes", amendments: [{ text: "Keep history", author: doctorId }] });
  const result = await complete(h);
  assert.equal(result.consultation.clinicalNotes, "Private notes");
  assert.equal(result.consultation.amendments[0].text, "Keep history");
  assert.equal(models.Consultation.schema.options.optimisticConcurrency, true);
});

test("unsupported transactions fail closed without writes", async () => {
  const h = harness(); h.stats.unsupported = true;
  await assert.rejects(complete(h), { status: 503, code: "TRANSACTIONS_REQUIRED" });
  assert.equal(h.stats.writes.length, 0);
});

test("uncertain commit never triggers compensation; identical retry retrieves the committed result", async () => {
  const h = harness(); h.stats.unknownCommit = true;
  await assert.rejects(complete(h), { status: 503, code: "COMPLETION_OUTCOME_UNKNOWN" });
  const before = copy(h.state); h.stats.unknownCommit = false;
  await complete(h);
  assert.deepEqual(h.state, before);
});

test("replay of a completion without prescription does not create events", async () => {
  const h = harness(); const body = payload(); delete body.prescription;
  await complete(h, body); const before = copy(h.state);
  const result = await complete(h, body);
  assert.equal(result.prescription, null);
  assert.deepEqual(h.state, before);
});

test("replay rejects missing committed prescription history without repairing or deleting", async () => {
  const h = harness(); await complete(h);
  // Simulate pre-existing data damage in the fake, not a real database deletion.
  h.state.Prescription = [];
  const before = copy(h.state);
  await assert.rejects(complete(h), { status: 409 });
  assert.deepEqual(h.state, before);
});

test("completed consultation on a scheduled appointment cannot be reverted", async () => {
  const h = harness();
  h.state.Consultation.push({ _id: otherId, appointment: appointmentId, patient: patientId, doctor: doctorId, status: "completed", clinicalNotes: "Committed notes" });
  const before = copy(h.state);
  await assert.rejects(complete(h), { status: 409 });
  assert.deepEqual(h.state, before);
});

test("stale draft save uses a version predicate and cannot overwrite a completed consultation", async (t) => {
  const doc = models.Consultation.hydrate({ _id: otherId, appointment: appointmentId, patient: patientId, doctor: doctorId, status: "draft", clinicalNotes: "Old notes", __v: 0 });
  doc.clinicalNotes = "Stale edit";
  t.mock.method(models.Consultation.collection, "updateOne", async (filter, update) => {
    assert.equal(filter.__v, 0);
    assert.equal(update.$inc.__v, 1);
    // Completion incremented __v, so the stale writer matches nothing.
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  });
  await assert.rejects(doc.save(), { name: "VersionError" });
});

test("stale appointment cancellation cannot overwrite transactional completion", async (t) => {
  const doc = models.Appointment.hydrate({ _id: appointmentId, doctor: doctorId, patient: patientId, problem: "Concern", status: "scheduled", __v: 0 });
  doc.status = "cancelled";
  t.mock.method(models.Appointment.collection, "updateOne", async (filter, update) => {
    assert.equal(filter.__v, 0);
    assert.equal(update.$inc.__v, 1);
    // The completion service's atomic update incremented the persisted version.
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  });
  await assert.rejects(doc.save(), { name: "VersionError" });
  const { errorHandler } = require("../middleware/errorHandler");
  const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  errorHandler(Object.assign(new Error("stale"), { name: "VersionError" }), {}, response, () => {});
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "STALE_RECORD");
});

test("identical retry remains idempotent after the follow-up date has passed", async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const h = harness(); const body = payload();
  body.prescription.followUpDate = new Date(now + 86400000).toISOString();
  await complete(h, body); const before = copy(h.state);
  t.mock.timers.tick(2 * 86400000);
  await complete(h, body);
  assert.deepEqual(h.state, before);
});
