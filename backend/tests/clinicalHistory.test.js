const { test } = require("node:test");
const assert = require("node:assert/strict");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const { loadClinicalHistory } = require("../services/clinicalHistory");
const { harness } = require("./helpers/schedulingHarness.cjs");
const { createSchedulingService } = require("../services/scheduling");
const { createCompletionService } = require("../services/consultationCompletion");
const query = value => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => value });
test("patient history contains only completed, consistently owned consultations and prescriptions", async t => {
  const patient = "507f1f77bcf86cd799439011", doctor = "507f1f77bcf86cd799439012";
  const appointment = { _id: "507f1f77bcf86cd799439013", patient, doctor, status: "completed", problem: "Synthetic" };
  const row = { _id: "507f1f77bcf86cd799439014", patient, doctor: { _id: doctor, name: "Synthetic" }, appointment, status: "completed", clinicalNotes: "Private", vitals: { pulseBpm: 70 }, completionRequestHash: "Private" };
  t.mock.method(Consultation, "find", filter => { assert.deepEqual(filter, { patient, status: "completed" }); return query([row, { ...row, _id: "draft", status: "draft" }, { ...row, _id: "cancelled", appointment: { ...appointment, status: "cancelled" } }, { ...row, _id: "other", patient: "other" }, { ...row, _id: "missing", appointment: null }]); });
  t.mock.method(Prescription, "find", filter => {
    assert.deepEqual(filter.consultation.$in, [row._id]);
    const rx = { _id: "rx", patient: { _id: patient }, doctor: { _id: doctor }, appointment, consultation: row._id, status: "voided", amendments: [{ text: "Synthetic amendment" }] };
    return query([rx, { ...rx, _id: "wrongDoctor", doctor: "other" }, { ...rx, _id: "wrongPatient", patient: "other" }, { ...rx, _id: "wrongAppointment", appointment: "other" }, { ...rx, _id: "unissued", consultation: "draft" }]);
  });
  const result = await loadClinicalHistory(patient);
  assert.equal(result.consultations.length, 1); assert.equal(result.prescriptions.length, 1); assert.equal(result.prescriptions[0].status, "voided");
  assert.equal(result.consultations[0].clinicalNotes, undefined); assert.equal(result.consultations[0].vitals, undefined); assert.equal(result.consultations[0].completionRequestHash, undefined);
  assert.equal(result.consultations[0].prescription._id, "rx");
});
test("empty completed history does not query or expose unrelated prescriptions", async t => {
  t.mock.method(Consultation, "find", () => query([])); t.mock.method(Prescription, "find", () => assert.fail("No eligible consultation IDs"));
  assert.deepEqual(await loadClinicalHistory("synthetic"), { consultations: [], prescriptions: [] });
});
const setup = async () => {
  const h = harness();
  const common = { name: "Synthetic", phone: "1234567890", password: "synthetic-hash", accountStatus: "active" };
  const doctor = h.add("User", { ...common, email: "doctor@example.test", role: "doctor", specialty: "ENT", doctorVerificationStatus: "verified" });
  const other = h.add("User", { ...common, email: "other@example.test", role: "doctor", specialty: "ENT", doctorVerificationStatus: "verified" });
  const patient = h.add("User", { ...common, email: "patient@example.test", role: "patient" });
  const appointment = h.add("Appointment", { doctor: doctor._id, patient: patient._id, problem: "Synthetic" });
  const complete = createCompletionService(h.db);
  await complete({ appointmentId: String(appointment._id), doctorId: String(doctor._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", clinicalNotes: "Private original", diagnosis: "Assessment", advice: "Advice" }, prescription: { medications: [{ medicineName: "Synthetic medicine", dosage: "Synthetic dose", frequency: "Synthetic frequency", duration: "Synthetic duration" }] } } });
  const api = createSchedulingService(h.db);
  return { ...h, api, doctor, other, prescriptionId: h.state.Prescription[0]._id, consultationId: h.state.Consultation[0]._id };
};
test("prescription amendments append atomically and concurrent identical requests are idempotent", async () => {
  const h = await setup(); const original = JSON.stringify(h.state.Prescription[0].medications);
  const args = { prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "Synthetic clarification", requestId: "synthetic-amendment-key-001" };
  const results = await Promise.all([h.api.amendPrescription(args), h.api.amendPrescription(args)]);
  assert.equal(String(results[0]._id), String(results[1]._id)); assert.equal(h.state.Prescription[0].amendments.length, 1);
  assert.equal(JSON.stringify(h.state.Prescription[0].medications), original);
  assert.equal(h.state.AuditLog.filter(row => row.action === "PRESCRIPTION_AMENDED").length, 1);
  assert.equal(h.state.Notification.filter(row => row.type === "PRESCRIPTION_AMENDED").length, 1);
  await assert.rejects(h.api.amendPrescription({ ...args, text: "Conflicting content" }), { status: 409 });
});
test("failed amendment notification rolls back amendment and audit without changing original prescription", async () => {
  const h = await setup(); const before = JSON.stringify(h.state); h.stats.failAt = "Notification";
  await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "Synthetic clarification" }), /Injected/);
  assert.equal(JSON.stringify(h.state), before);
});
test("unrelated, pending and rejected doctors cannot amend or void another clinical record", async () => {
  const h = await setup();
  await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.other._id, text: "Synthetic clarification" }), { status: 404 });
  await assert.rejects(h.api.voidPrescription({ prescriptionId: h.prescriptionId, doctorId: h.other._id, reason: "Synthetic correction" }), { status: 404 });
  for (const status of ["pending", "rejected"]) { h.state.User[0].doctorVerificationStatus = status; await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "Synthetic clarification" }), { status: 404 }); }
});
test("voided prescriptions retain original medicines and amendments and refuse new amendments", async () => {
  const h = await setup(); const original = JSON.stringify(h.state.Prescription[0].medications);
  await h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "Synthetic clarification" });
  await h.api.voidPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, reason: "Synthetic correction" });
  await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "New clarification" }), { status: 409 });
  assert.equal(h.state.Prescription[0].amendments.length, 1); assert.equal(JSON.stringify(h.state.Prescription[0].medications), original);
});
test("consultation amendment retries do not duplicate notes or overwrite original clinical notes", async () => {
  const h = await setup(); const args = { consultationId: h.consultationId, doctorId: h.doctor._id, text: "Synthetic addition" };
  await Promise.all([h.api.amend(args), h.api.amend(args)]);
  assert.equal(h.state.Consultation[0].amendments.length, 1); assert.equal(h.state.Consultation[0].clinicalNotes, "Private original");
});
test("inconsistent appointment state prevents prescription amendment and voiding", async () => {
  const h = await setup(); h.state.Appointment[0].status = "cancelled";
  await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, text: "Synthetic clarification" }), { status: 409 });
  await assert.rejects(h.api.voidPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, reason: "Synthetic correction" }), { status: 409 });
});
test("invalid amendment payloads cannot create writes", async () => {
  const h = await setup(); const before = JSON.stringify(h.state);
  for (const extra of [{ text: " " }, { text: "x".repeat(4001) }, { text: "Synthetic", requestId: "short" }]) await assert.rejects(h.api.amendPrescription({ prescriptionId: h.prescriptionId, doctorId: h.doctor._id, ...extra }), { status: 400 });
  assert.equal(JSON.stringify(h.state), before);
});
