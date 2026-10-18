const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const AuditLog = require("../models/AuditLog");
const { assertAssignedAppointment, assertPatientOwnership, assertTransition, hasClinicalRelationship, sanitizeConsultation, sanitizePrescription, validateAvailability, completeClinicalState, buildPrescriptionRecord, writeAudit } = require("../services/clinicalDomain");

test("doctor cannot access an unrelated patient's appointment", async () => {
  const original = Appointment.findOne;
  Appointment.findOne = () => ({ populate() { return this; }, then(resolve) { resolve(null); } });
  try { await assert.rejects(assertAssignedAppointment(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()), /not found/); }
  finally { Appointment.findOne = original; }
});

test("doctor can resume a draft only through valid draft transition", () => {
  assert.doesNotThrow(() => assertTransition("draft", "draft"));
  assert.doesNotThrow(() => assertTransition("draft", "completed"));
  assert.throws(() => assertTransition("completed", "draft"), /Invalid consultation/);
  assert.throws(() => assertTransition("completed", "completed"), /Invalid consultation/);
});

test("patient ownership prevents cross-patient prescription and consultation reads", () => {
  const patient = new mongoose.Types.ObjectId();
  assert.doesNotThrow(() => assertPatientOwnership({ patient }, patient));
  assert.throws(() => assertPatientOwnership({ patient }, new mongoose.Types.ObjectId()), /not found/);
});

test("prescription sanitization requires explicit complete medication fields and ignores ownership input", () => {
  assert.throws(() => sanitizePrescription({ medications: [{ medicineName: "A" }] }), /requires/);
  const result = sanitizePrescription({ patient: "attacker", doctor: "attacker", medications: [{ medicineName: "Medicine", dosage: "1 tablet", frequency: "daily", duration: "3 days" }] });
  assert.equal(result.medications.length, 1);
  assert.equal("patient" in result, false); assert.equal("doctor" in result, false);
});

test("consultation sanitization excludes ownership and status mass assignment", () => {
  const result = sanitizeConsultation({ doctor: "attacker", patient: "attacker", status: "completed", diagnosis: "Assessment" });
  assert.equal(result.diagnosis, "Assessment"); assert.equal("doctor" in result, false); assert.equal("status" in result, false);
});

test("medical record relationship requires an assigned appointment", async () => {
  const original = Appointment.exists;
  try { Appointment.exists = async () => null; assert.equal(await hasClinicalRelationship("doctor", "patient"), false); Appointment.exists = async () => ({ _id: "relationship" }); assert.equal(await hasClinicalRelationship("doctor", "patient"), true); }
  finally { Appointment.exists = original; }
});
test("cancelled-only relationships cannot grant medical file access; completed history remains eligible", async (t) => {
  t.mock.method(Appointment, "exists", async filter => {
    assert.deepEqual(filter.status, { $in: ["scheduled", "completed"] });
    return null;
  });
  assert.equal(await hasClinicalRelationship("doctor", "patient"), false);
});

test("availability validation rejects duplicate weekdays and invalid ranges", () => {
  const valid = [{ weekday: 1, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 30 }];
  assert.doesNotThrow(() => validateAvailability(valid, []));
  assert.throws(() => validateAvailability([...valid, ...valid], []), /Invalid availability/);
  assert.throws(() => validateAvailability([{ ...valid[0], startTime: "18:00" }], []), /Invalid availability/);
});

test("sensitive medical access audit records only controlled metadata", async () => {
  const original = AuditLog.create; let captured;
  AuditLog.create = async (value) => { captured = value; return value; };
  try { await writeAudit({ actor: new mongoose.Types.ObjectId(), actorRole: "doctor", action: "MEDICAL_RECORD_VIEWED_BY_DOCTOR", targetType: "MedicalRecord", targetId: new mongoose.Types.ObjectId(), patient: new mongoose.Types.ObjectId(), metadata: { access: "file" } }); assert.deepEqual(captured.metadata, { access: "file" }); }
  finally { AuditLog.create = original; }
});

test("completing a draft consultation also completes its appointment", () => {
  const consultation = { status: "draft" }; const appointment = { status: "scheduled" }; completeClinicalState(consultation, appointment, new Date("2030-01-01")); assert.equal(consultation.status, "completed"); assert.equal(appointment.status, "completed"); assert.equal(consultation.completedAt.toISOString(), "2030-01-01T00:00:00.000Z");
});

test("prescription ownership is derived from assigned clinical records", () => {
  const patient = new mongoose.Types.ObjectId(); const doctor = new mongoose.Types.ObjectId(); const appointment = { _id: new mongoose.Types.ObjectId(), patient: { _id: patient } }; const consultation = { _id: new mongoose.Types.ObjectId() }; const result = buildPrescriptionRecord({ values: { medications: [] }, appointment, consultation, doctorId: doctor }); assert.equal(String(result.patient), String(patient)); assert.equal(String(result.doctor), String(doctor)); assert.equal(String(result.appointment), String(appointment._id));
});
