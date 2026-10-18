"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { createCompletionService } = require("../../services/consultationCompletion");
const { createSchedulingService } = require("../../services/scheduling");
const { runSchedulingScenarios } = require("./scheduling.cjs");

const names = ["User", "Appointment", "Consultation", "Prescription", "AuditLog", "Notification"];
function bindModels(instance) {
  const models = {};
  for (const name of names) {
    const schema = require(`../../models/${name}`).schema.clone();
    schema.set("autoCreate", false); schema.set("autoIndex", false);
    models[name] = instance.model(name, schema);
  }
  return { models, complete: createCompletionService({ mongoose: instance, ...models }), scheduling: createSchedulingService({ mongoose: instance, ...models }) };
}
const body = () => ({ appointmentVersion: 0, consultation: { chiefComplaint: "Fixture concern", diagnosis: "Fixture assessment", advice: "Fixture advice" },
  prescription: { medications: [{ medicineName: "Fixture medicine", dosage: "Fixture dosage", frequency: "Fixture frequency", duration: "Fixture duration" }] } });
async function fixture(context, draft = false) {
  const suffix = crypto.randomUUID();
  const user = { name: "Transaction fixture", phone: "9999999991", password: "invalid-bcrypt-fixture-not-a-login", isVerified: true, accountStatus: "active" };
  const doctor = await context.models.User.create({ ...user, email: `doctor.${suffix}@example.test`, role: "doctor", doctorVerificationStatus: "verified", isDoctorVerified: true });
  const patient = await context.models.User.create({ ...user, email: `patient.${suffix}@example.test`, role: "patient" });
  const appointment = await context.models.Appointment.create({ doctor: doctor._id, patient: patient._id, problem: "Transaction fixture concern", status: "scheduled" });
  if (draft) await context.models.Consultation.create({ appointment: appointment._id, doctor: doctor._id, patient: patient._id, status: "draft", clinicalNotes: "Original private fixture note" });
  return { doctor, patient, appointment, input: body() };
}
const complete = (context, f, input = f.input) => context.complete({ appointmentId: String(f.appointment._id), doctorId: String(f.doctor._id), body: input });
async function snapshot(context, f) {
  const m = context.models;
  const results = await Promise.all([
    m.Appointment.findById(f.appointment._id).lean(),
    m.Consultation.find({ appointment: f.appointment._id }).select("+clinicalNotes +completionRequestHash +completionPrescription +completionSafetyWarnings").sort({ _id: 1 }).lean(),
    m.Prescription.find({ appointment: f.appointment._id }).sort({ _id: 1 }).lean(),
    m.AuditLog.find({ patient: f.patient._id }).sort({ _id: 1 }).lean(),
    m.Notification.find({ recipient: f.patient._id }).sort({ _id: 1 }).lean(),
  ]);
  return JSON.parse(JSON.stringify({ appointment: results[0], consultations: results[1], prescriptions: results[2], audits: results[3], notifications: results[4] }));
}
function assertCommitted(value) {
  assert.equal(value.appointment.status, "completed");
  assert.equal(value.consultations.length, 1);
  assert.equal(value.consultations[0].status, "completed");
  assert.equal(value.prescriptions.length, 1);
  assert.equal(value.audits.length, 3);
  assert.deepEqual(value.audits.map((event) => event.action).sort(), ["APPOINTMENT_COMPLETED", "CONSULTATION_COMPLETED", "PRESCRIPTION_CREATED"]);
  assert.equal(value.notifications.length, 1);
  assert.equal(value.notifications[0].type, "CONSULTATION_COMPLETED");
  assert.equal(value.consultations[0].completionPrescription, value.prescriptions[0]._id);
}
const assertDuplicate = (operation) => assert.rejects(operation, (error) => error.code === 11000);
const cloneRecord = (record) => {
  const value = record.toObject();
  delete value._id; delete value.__v; delete value.createdAt; delete value.updatedAt;
  return value;
};

async function runScenarios({ rs, standalone, config, appName, options }) {
  const replica = bindModels(rs); const single = bindModels(standalone);
  // Called only after both preflights pass. No syncIndexes(), collection drops,
  // database drops, deleteMany(), or cleanup of unknown/pre-existing documents.
  for (const context of [replica, single]) {
    for (const model of Object.values(context.models)) {
      await model.createCollection();
      await model.createIndexes();
    }
  }
  const commands = [];
  const client = rs.connection.getClient();
  const onStarted = (event) => commands.push({ command: event.commandName, transaction: event.command.autocommit === false, session: Boolean(event.command.lsid) });
  let uncertainAcknowledgement = false;
  const onSucceeded = (event) => {
    if (event.commandName === "commitTransaction" && event.reply.writeConcernError) uncertainAcknowledgement = true;
  };
  client.on("commandStarted", onStarted); client.on("commandSucceeded", onSucceeded);
  const admin = rs.connection.db.admin();
  let passed = 0; let failed = 0;
  const check = async (label, operation) => {
    try { await operation(); passed += 1; console.log(`PASS ${label}`); }
    catch (error) {
      failed += 1;
      const code = Number.isInteger(error.code) ? `SERVER_${error.code}` : error.name === "AssertionError" ? "ASSERTION" : "SCENARIO_ERROR";
      // No raw error, assertion values, command documents or URI are logged.
      console.error(`FAIL ${label} [${code}]`);
    }
  };
  let failpointActive = false;
  async function failCommits(mode, operation) {
    await admin.command({ configureFailPoint: "failCommand", mode, data: {
      failCommands: ["commitTransaction"], appName,
      writeConcernError: { code: 64, errmsg: "Disposable fixture acknowledgement uncertainty" },
      errorLabels: ["UnknownTransactionCommitResult"],
    } });
    failpointActive = true;
    try { await operation(); }
    finally {
      // Server-wide control is permitted only on the preflight-verified,
      // dedicated local test server. Never run this harness on shared servers.
      await admin.command({ configureFailPoint: "failCommand", mode: "off" });
      failpointActive = false;
    }
  }
  try {
    await check("required unique index definitions exist", async () => {
      for (const [name, keys] of [["Consultation", ["appointment"]], ["Prescription", ["appointment", "consultation"]]]) {
        const indexes = await replica.models[name].collection.listIndexes().toArray();
        for (const key of keys) assert.ok(indexes.some((index) => index.unique === true && Object.keys(index.key).length === 1 && index.key[key] === 1));
      }
      const appointmentIndexes = await replica.models.Appointment.collection.listIndexes().toArray();
      for (const owner of ["doctor", "patient"]) assert.ok(appointmentIndexes.some((index) => index.unique === true && index.key[owner] === 1 && index.key.startAt === 1 && index.partialFilterExpression?.status === "scheduled"));
    });
    await check("successful completion and committed audit/notification records", async () => {
      const f = await fixture(replica, true);
      const start = commands.length;
      const result = await complete(replica, f);
      assert.ok(result.appointment.patient.name);
      assert.ok(result.appointment.doctor.name);
      assert.equal(result.consultation.clinicalNotes, "Original private fixture note");
      assertCommitted(await snapshot(replica, f));
      const writes = commands.slice(start).filter((event) => ["findAndModify", "update", "insert"].includes(event.command));
      assert.ok(writes.length >= 6);
      assert.ok(writes.every((event) => event.transaction && event.session));
    });
    await check("invalid prescription produces no persisted changes", async () => {
      const f = await fixture(replica, true); const before = await snapshot(replica, f);
      f.input.prescription.medications[0].dosage = "";
      await assert.rejects(complete(replica, f), { status: 400 });
      assert.deepEqual(await snapshot(replica, f), before);
    });
    for (const name of ["Appointment", "Consultation", "Prescription", "AuditLog", "Notification"]) {
      await check(`real server write rejection at ${name} rolls back clinical records and events`, async () => {
        const f = await fixture(replica, true); const before = await snapshot(replica, f);
        const collection = replica.models[name].collection.collectionName;
        const validator = name === "Appointment" ? { $or: [{ _id: { $ne: f.appointment._id } }, { status: { $ne: "completed" } }] }
          : name === "AuditLog" ? { targetId: { $ne: f.appointment._id } }
            : name === "Notification" ? { recipient: { $ne: f.patient._id } } : { appointment: { $ne: f.appointment._id } };
        await rs.connection.db.command({ collMod: collection, validator, validationLevel: "strict", validationAction: "error" });
        const start = commands.length;
        try { await assert.rejects(complete(replica, f), (error) => error.code === 121); }
        finally { await rs.connection.db.command({ collMod: collection, validator: {}, validationLevel: "strict" }); }
        assert.ok(commands.slice(start).some((event) => event.command === "abortTransaction"));
        assert.deepEqual(await snapshot(replica, f), before);
      });
    }
    await check("concurrent identical completions create one consultation, prescription and event set", async () => {
      const f = await fixture(replica);
      const results = await Promise.all(Array.from({ length: 4 }, () => complete(replica, f)));
      assert.equal(new Set(results.map((result) => String(result.consultation._id))).size, 1);
      assertCommitted(await snapshot(replica, f));
    });
    await check("concurrent conflicting completions preserve one winner", async () => {
      const f = await fixture(replica); const changed = body(); changed.consultation.advice = "Conflicting fixture advice";
      const results = await Promise.allSettled([complete(replica, f), complete(replica, f, changed)]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
      assertCommitted(await snapshot(replica, f));
    });
    await check("concurrent cancellation versus completion has one valid final state", async () => {
      for (let round = 0; round < 5; round += 1) {
        const f = await fixture(replica);
        const [completion, cancellation] = await Promise.allSettled([
          complete(replica, f),
          replica.models.Appointment.findOneAndUpdate({ _id: f.appointment._id, doctor: f.doctor._id, status: "scheduled" }, { $set: { status: "cancelled" } }, { new: true, runValidators: true }),
        ]);
        assert.equal(cancellation.status, "fulfilled");
        const value = await snapshot(replica, f);
        if (completion.status === "fulfilled") { assert.equal(cancellation.value, null); assertCommitted(value); }
        else {
          assert.equal(completion.reason.status, 409);
          assert.equal(value.appointment.status, "cancelled");
          for (const key of ["consultations", "prescriptions", "audits", "notifications"]) assert.equal(value[key].length, 0);
        }
      }
    });
    await check("identical retries do not modify committed records or duplicate events", async () => {
      const f = await fixture(replica); await complete(replica, f);
      const before = await snapshot(replica, f);
      await complete(replica, f); await complete(replica, f);
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await check("conflicting retry is rejected without rewriting history", async () => {
      const f = await fixture(replica); await complete(replica, f); const before = await snapshot(replica, f);
      const changed = body(); changed.consultation.diagnosis = "Changed fixture assessment";
      await assert.rejects(complete(replica, f, changed), { status: 409 });
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await check("real unique constraints reject duplicate consultations and prescription keys", async () => {
      const f = await fixture(replica); await complete(replica, f);
      const consultation = await replica.models.Consultation.findOne({ appointment: f.appointment._id });
      const prescription = await replica.models.Prescription.findOne({ appointment: f.appointment._id });
      await assertDuplicate(replica.models.Consultation.create(cloneRecord(consultation)));
      await assertDuplicate(replica.models.Prescription.create({ ...cloneRecord(prescription), consultation: new mongoose.Types.ObjectId() }));
      await assertDuplicate(replica.models.Prescription.create({ ...cloneRecord(prescription), appointment: new mongoose.Types.ObjectId() }));
      assertCommitted(await snapshot(replica, f));
    });
    await check("real appointment unique indexes reject identical doctor and patient slots", async () => {
      const f = await fixture(replica);
      const slot = { doctor: f.doctor._id, patient: f.patient._id, problem: "Index fixture", startAt: new Date("2035-01-01T10:00:00Z"), status: "scheduled" };
      await replica.models.Appointment.create(slot);
      await assertDuplicate(replica.models.Appointment.create({ ...slot, patient: new mongoose.Types.ObjectId() }));
      await assertDuplicate(replica.models.Appointment.create({ ...slot, doctor: new mongoose.Types.ObjectId() }));
    });
    await check("stale draft save cannot overwrite completed notes", async () => {
      const f = await fixture(replica, true);
      const stale = await replica.models.Consultation.findOne({ appointment: f.appointment._id }).select("+clinicalNotes");
      await complete(replica, f); const before = await snapshot(replica, f);
      stale.clinicalNotes = "Stale fixture edit";
      await assert.rejects(stale.save(), { name: "VersionError" });
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await check("stale patient/admin-style cancellation save cannot overwrite completion", async () => {
      const f = await fixture(replica); const stale = await replica.models.Appointment.findById(f.appointment._id);
      await complete(replica, f); const before = await snapshot(replica, f);
      stale.status = "cancelled";
      await assert.rejects(stale.save(), { name: "VersionError" });
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await check("standalone MongoDB fails closed with no clinical writes", async () => {
      const f = await fixture(single, true); const before = await snapshot(single, f);
      await assert.rejects(complete(single, f), { status: 503, code: "TRANSACTIONS_REQUIRED" });
      assert.deepEqual(await snapshot(single, f), before);
    });
    await check("uncertain commit acknowledgement is retried by the real driver without duplicates", async () => {
      const f = await fixture(replica); const start = commands.length; uncertainAcknowledgement = false;
      await failCommits({ times: 1 }, async () => { await complete(replica, f); });
      assert.ok(uncertainAcknowledgement);
      assert.ok(commands.slice(start).filter((event) => event.command === "commitTransaction").length >= 2);
      assertCommitted(await snapshot(replica, f));
    });
    await check("persistent commit acknowledgement uncertainty preserves committed records for replay", async () => {
      const f = await fixture(replica); uncertainAcknowledgement = false;
      await failCommits("alwaysOn", async () => {
        await assert.rejects(complete(replica, f), { status: 503, code: "COMPLETION_OUTCOME_UNKNOWN" });
      });
      assert.ok(uncertainAcknowledgement);
      const before = await snapshot(replica, f); assertCommitted(before);
      await complete(replica, f);
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await check("closed test-only connection fails without modifying committed data", async () => {
      const f = await fixture(replica); const before = await snapshot(replica, f);
      const unavailable = new mongoose.Mongoose();
      try {
        await unavailable.connect(config.rs.uri, { ...options, appName: `${appName}-closed` });
        const closed = bindModels(unavailable);
        await unavailable.disconnect();
        await assert.rejects(complete(closed, f));
      } finally { await unavailable.disconnect(); }
      assert.deepEqual(await snapshot(replica, f), before);
    });
    await runSchedulingScenarios({ replica, single, check, rs, failCommits });
  } finally {
    if (failpointActive) await admin.command({ configureFailPoint: "failCommand", mode: "off" });
    client.off("commandStarted", onStarted); client.off("commandSucceeded", onSucceeded);
  }
  return { passed, failed };
}

module.exports = { runScenarios };
