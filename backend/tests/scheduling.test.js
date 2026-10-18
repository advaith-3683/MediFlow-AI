const { test } = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers/schedulingHarness.cjs");
const { createSchedulingService } = require("../services/scheduling");
const { createCompletionService } = require("../services/consultationCompletion");
const { createStartAt, canonicalStartAt } = require("../services/appointmentDomain");
const { slotsForDate } = require("../services/appointmentSlots");
const setup = () => {
  const h = harness(); const user = { name: "Synthetic fixture", phone: "1234567890", password: "synthetic-hash", accountStatus: "active" };
  const doctor = (extra = {}) => h.add("User", { ...user, email: `synthetic-${h.state.User.length}@example.test`, role: "doctor", specialty: "ENT", doctorVerificationStatus: "verified", availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "12:00", appointmentDurationMinutes: 30 })), ...extra });
  const patient = () => h.add("User", { ...user, email: `synthetic-${h.state.User.length}@example.test`, role: "patient" });
  const d1 = doctor(); const d2 = doctor(); const p1 = patient(); const p2 = patient();
  const api = createSchedulingService(h.db);
  const body = (doctorId = d1._id, time = "09:00", extra = {}) => ({ doctor: String(doctorId), problem: "Synthetic concern", startAt: createStartAt("2035-01-01", time).toISOString(), durationMinutes: 30, ...extra });
  const book = (p = p1, values = body()) => api.book({ patientId: String(p._id), body: values });
  return { ...h, api, d1, d2, p1, p2, body, book };
};
const oneWinner = results => { assert.equal(results.filter(item => item.status === "fulfilled").length, 1); assert.equal(results.find(item => item.status === "rejected").reason.status, 409); };
test("simultaneous same-doctor same-slot bookings have one winner after conflict retry", async () => {
  const h = setup(); oneWinner(await Promise.allSettled([h.book(), h.book(h.p2)])); assert.equal(h.state.Appointment.length, 1); assert.ok(h.stats.retries);
});
test("different starts overlapping an existing longer doctor appointment are rejected", async () => {
  const h = setup();
  h.state.User.find(item => String(item._id) === String(h.d1._id)).availability.forEach(day => { day.appointmentDurationMinutes = 60; });
  await h.book(h.p1, h.body(h.d1._id, "09:00", { durationMinutes: 60 }));
  h.state.User.find(item => String(item._id) === String(h.d1._id)).availability.forEach(day => { day.appointmentDurationMinutes = 30; });
  await assert.rejects(h.book(h.p2, h.body(h.d1._id, "09:30")), { status: 409 });
  assert.equal(h.state.Appointment.length, 1);
});
test("different-start patient overlaps across doctors are rejected concurrently", async () => {
  const h = setup(); h.state.User[1].availability.forEach(day => { day.startTime = "09:15"; });
  oneWinner(await Promise.allSettled([h.book(), h.book(h.p1, h.body(h.d2._id, "09:15"))]));
});
test("same patient booking different doctors simultaneously cannot overlap", async () => {
  const h = setup(); oneWinner(await Promise.allSettled([h.book(), h.book(h.p1, h.body(h.d2._id))])); assert.equal(h.state.Appointment.length, 1);
});
test("parallel non-overlapping bookings can both commit", async () => {
  const h = setup(); await Promise.all([h.book(), h.book(h.p2, h.body(h.d1._id, "09:30"))]); assert.equal(h.state.Appointment.length, 2);
});
test("identical duplicate requests converge to one appointment and one pair of notifications", async () => {
  const h = setup(); const results = await Promise.all([h.book(), h.book()]);
  assert.equal(String(results[0].appointment._id), String(results[1].appointment._id)); assert.equal(h.state.Appointment.length, 1); assert.equal(h.state.Notification.length, 2); assert.equal(h.state.AuditLog.length, 1);
});
test("explicit request key rejects conflicting payload and replays original after cancellation", async () => {
  const h = setup(); const values = h.body(h.d1._id, "09:00", { requestId: "synthetic-request-key-0001" }); const result = await h.book(h.p1, values);
  await assert.rejects(h.book(h.p1, { ...values, problem: "Changed" }), { status: 409 });
  await h.api.cancel({ appointmentId: result.appointment._id, actorId: h.p1._id, actorRole: "patient", appointmentVersion: 0 });
  assert.equal((await h.book(h.p1, values)).appointment.status, "cancelled"); assert.equal(h.state.Appointment.length, 1);
});
for (const stage of ["Appointment", "AuditLog", "Notification"]) test(`${stage} failure rolls back booking, account locks and all events`, async () => {
  const h = setup(); const before = JSON.stringify(h.state); h.stats.failAt = stage;
  await assert.rejects(h.book(), /Injected/); assert.equal(JSON.stringify(h.state), before);
});
test("concurrent reschedules accept only one different target; identical replay has no events", async () => {
  const h = setup(); const { appointment } = await h.book();
  const move = time => h.api.reschedule({ appointmentId: appointment._id, patientId: h.p1._id, body: { ...h.body(h.d1._id, time), appointmentVersion: 0 } });
  oneWinner(await Promise.allSettled([move("10:00"), move("11:00")]));
  const stored = h.state.Appointment[0]; const count = h.state.Notification.length;
  await h.api.reschedule({ appointmentId: appointment._id, patientId: h.p1._id, body: { startAt: new Date(stored.startAt).toISOString(), durationMinutes: 30, appointmentVersion: 0 } });
  assert.equal(h.state.Notification.length, count);
});
test("concurrent rescheduling of two appointments into the same doctor interval has one winner", async () => {
  const h = setup(); const first = await h.book(); const second = await h.book(h.p2, h.body(h.d1._id, "10:00"));
  oneWinner(await Promise.allSettled([[first, h.p1], [second, h.p2]].map(([value, person]) => h.api.reschedule({ appointmentId: value.appointment._id, patientId: person._id, body: { ...h.body(h.d1._id, "11:00"), appointmentVersion: 0 } }))));
  assert.equal(h.state.Appointment.length, 2);
});
test("cancellation versus rescheduling cannot overwrite a winner using stale version", async () => {
  const h = setup(); const { appointment } = await h.book();
  oneWinner(await Promise.allSettled([h.api.cancel({ appointmentId: appointment._id, actorId: h.p1._id, actorRole: "patient", appointmentVersion: 0 }), h.api.reschedule({ appointmentId: appointment._id, patientId: h.p1._id, body: { ...h.body(h.d1._id, "10:00"), appointmentVersion: 0 } })]));
  assert.equal(h.state.Appointment[0].__v, 1);
});
test("cancellation releases interval for a different patient without deleting history", async () => {
  const h = setup(); const { appointment } = await h.book();
  await h.api.cancel({ appointmentId: appointment._id, actorId: h.p1._id, actorRole: "patient", appointmentVersion: 0 });
  await h.book(h.p2); assert.equal(h.state.Appointment.length, 2); assert.equal(h.state.Appointment[0].status, "cancelled");
});
test("cancellation versus completion commits exactly one state with no partial clinical records", async () => {
  const h = setup(); const { appointment } = await h.book();
  const complete = createCompletionService(h.db);
  oneWinner(await Promise.allSettled([h.api.cancel({ appointmentId: appointment._id, actorId: h.p1._id, actorRole: "patient", appointmentVersion: 0 }), complete({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" } } })]));
  assert.equal(h.state.Consultation.length, h.state.Appointment[0].status === "completed" ? 1 : 0);
});
test("draft save guards appointment and blocks stale completion/reschedule", async () => {
  const h = setup(); const { appointment } = await h.book();
  const result = await h.api.saveDraft({ appointmentId: appointment._id, doctorId: h.d1._id, body: { appointmentVersion: 0, chiefComplaint: "Original notes" } });
  assert.equal(result.appointmentVersion, 1);
  await assert.rejects(h.api.reschedule({ appointmentId: appointment._id, patientId: h.p1._id, body: { ...h.body(h.d1._id, "10:00"), appointmentVersion: 1 } }), { status: 409 });
  await assert.rejects(createCompletionService(h.db)({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" } } }), { status: 409 });
  assert.equal(h.state.Consultation[0].chiefComplaint, "Original notes");
});
test("draft cannot be saved after cancellation", async () => {
  const h = setup(); const { appointment } = await h.book(); await h.api.cancel({ appointmentId: appointment._id, actorId: h.p1._id, actorRole: "patient", appointmentVersion: 0 });
  await assert.rejects(h.api.saveDraft({ appointmentId: appointment._id, doctorId: h.d1._id, body: { appointmentVersion: 1 } }), { status: 409 }); assert.equal(h.state.Consultation.length, 0);
});
test("availability changes serialize with booking and preserve confirmed appointments", async () => {
  const h = setup(); const results = await Promise.allSettled([h.book(), h.api.availability({ doctorId: h.d1._id, body: { availability: [], unavailableDates: [] } })]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  if (h.state.Appointment.length) {
    await h.api.availability({ doctorId: h.d1._id, body: { availability: [], unavailableDates: [], confirmConflicts: true } });
    assert.equal(h.state.Appointment[0].status, "scheduled");
  }
});
for (const value of [null, 0, "2035-01-01", "2035-01-01T09:00:00", "2035-01-01T09:00:00+05:30", "2035-02-30T09:00:00.000Z", "2035-01-01T09:00:01.000Z", "2035-01-01T09:00:00.001Z"]) test(`reject noncanonical timestamp ${value}`, () => assert.throws(() => canonicalStartAt(value), { status: 400 }));
test("availability boundaries, duration and blocked dates are enforced", async () => {
  const h = setup();
  for (const values of [h.body(h.d1._id, "08:30"), h.body(h.d1._id, "12:00"), h.body(h.d1._id, "09:15"), h.body(h.d1._id, "09:00", { durationMinutes: 15 })]) await assert.rejects(h.book(h.p1, values), { status: 400 });
  h.state.User[0].unavailableDates = ["2035-01-01"];
  await assert.rejects(h.book(), { status: 400 }); assert.equal(h.state.Appointment.length, 0);
});
test("pending, rejected and unrelated doctors/patients cannot mutate appointments", async () => {
  const h = setup(); const { appointment } = await h.book();
  await assert.rejects(h.api.cancel({ appointmentId: appointment._id, actorId: h.p2._id, actorRole: "patient", appointmentVersion: 0 }), { status: 404 });
  await assert.rejects(h.api.saveDraft({ appointmentId: appointment._id, doctorId: h.d2._id, body: { appointmentVersion: 0 } }), { status: 404 });
  for (const status of ["pending", "rejected"]) { h.state.User[0].doctorVerificationStatus = status; h.state.User[0].isDoctorVerified = true; await assert.rejects(h.book(h.p2, h.body(h.d1._id, "10:00")), { status: 404 }); }
});
test("unsupported transactions fail closed; unknown commit retries replay without duplicate events", async () => {
  const h = setup(); h.stats.unsupported = true; await assert.rejects(h.book(), { code: "TRANSACTIONS_REQUIRED" }); assert.equal(h.state.Appointment.length, 0);
  h.stats.unsupported = false; h.stats.unknownCommit = true;
  await assert.rejects(h.book(), { code: "SCHEDULING_OUTCOME_UNKNOWN" }); await h.book(); assert.equal(h.state.Appointment.length, 1); assert.equal(h.state.Notification.length, 2);
});
test("concurrent identical prescription voids commit one notification and preserve history", async () => {
  const h = setup(); const { appointment } = await h.book();
  await createCompletionService(h.db)({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" }, prescription: { generalInstructions: "Synthetic instructions" } } });
  const prescriptionId = h.state.Prescription[0]._id;
  await Promise.all([1, 2].map(() => h.api.voidPrescription({ prescriptionId, doctorId: h.d1._id, reason: "Synthetic correction" })));
  assert.equal(h.state.Prescription.length, 1); assert.equal(h.state.Prescription[0].status, "voided");
  assert.equal(h.state.Notification.filter(item => item.type === "PRESCRIPTION_VOIDED").length, 1);
});
test("failed void notification rolls back status, reason and audit", async () => {
  const h = setup(); const { appointment } = await h.book();
  await createCompletionService(h.db)({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" }, prescription: { generalInstructions: "Synthetic instructions" } } });
  const before = JSON.stringify(h.state); h.stats.failAt = "Notification";
  await assert.rejects(h.api.voidPrescription({ prescriptionId: h.state.Prescription[0]._id, doctorId: h.d1._id, reason: "Synthetic correction" }), /Injected/);
  assert.equal(JSON.stringify(h.state), before);
});
test("concurrent amendments preserve both additions and original completed notes", async () => {
  const h = setup(); const { appointment } = await h.book();
  await createCompletionService(h.db)({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", clinicalNotes: "Original", diagnosis: "Assessment", advice: "Advice" } } });
  const consultationId = h.state.Consultation[0]._id;
  await Promise.all(["First addition", "Second addition"].map(text => h.api.amend({ consultationId, doctorId: h.d1._id, text })));
  assert.equal(h.state.Consultation[0].amendments.length, 2); assert.equal(h.state.Consultation[0].clinicalNotes, "Original");
});
test("invalid blocked dates and null availability entries return validation errors", async () => {
  const h = setup();
  await assert.rejects(h.api.availability({ doctorId: h.d1._id, body: { availability: [], unavailableDates: ["2035-02-30"] } }), { status: 400 });
  await assert.rejects(h.api.availability({ doctorId: h.d1._id, body: { availability: [null], unavailableDates: [] } }), { status: 400 });
});
test("missing appointment versions cannot cancel, reschedule, save draft or complete", async () => {
  const h = setup(); const { appointment } = await h.book();
  await assert.rejects(h.api.cancel({ appointmentId: appointment._id, actorId: h.p1._id, actorRole: "patient" }), { status: 400 });
  await assert.rejects(h.api.reschedule({ appointmentId: appointment._id, patientId: h.p1._id, body: h.body(h.d1._id, "10:00") }), { status: 400 });
  await assert.rejects(h.api.saveDraft({ appointmentId: appointment._id, doctorId: h.d1._id, body: {} }), { status: 400 });
  await assert.rejects(createCompletionService(h.db)({ appointmentId: String(appointment._id), doctorId: String(h.d1._id), body: { consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" } } }), { status: 400 });
  assert.equal(h.state.Appointment[0].status, "scheduled");
});
test("known legacy appointment intervals block overlap; missing legacy dates fail closed", async () => {
  const h = setup();
  h.add("Appointment", { doctor: h.d1._id, patient: h.p2._id, problem: "Legacy fixture", appointmentDate: "2035-01-01", appointmentTime: "9:00 AM", durationMinutes: 60 });
  await assert.rejects(h.book(h.p1, h.body(h.d1._id, "09:30")), { status: 409 });
  h.state.Appointment[0].appointmentDate = "";
  await assert.rejects(h.book(h.p1, h.body(h.d1._id, "10:30")), { code: "LEGACY_SCHEDULE_REVIEW_REQUIRED" });
  assert.deepEqual(slotsForDate(h.d1, "2035-01-01", h.state.Appointment, new Date("2034-01-01")), []);
});
test("final full slot fits closing boundary and clinic dates round-trip through UTC", async () => {
  const h = setup(); const value = h.body(h.d1._id, "11:30");
  const { appointment } = await h.book(h.p1, value);
  assert.equal(new Date(appointment.startAt).toISOString(), value.startAt);
  assert.equal(appointment.appointmentDate, "2035-01-01");
  await assert.rejects(h.book(h.p2, h.body(h.d1._id, "12:00")), { status: 400 });
});
