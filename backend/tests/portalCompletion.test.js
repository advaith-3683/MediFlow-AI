const { test } = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers/schedulingHarness.cjs");
const { createAdminActions } = require("../services/adminActions");
const { createSchedulingService } = require("../services/scheduling");
const { pageValues, dateRange } = require("../services/adminQueries");
const { createStartAt } = require("../services/appointmentDomain");
const setup = () => {
  const h = harness();
  const common = { name: "Synthetic", phone: "1234567890", password: "synthetic-hash", accountStatus: "active" };
  const admin = h.add("User", { ...common, role: "admin", email: "admin@example.test" });
  const doctor = h.add("User", { ...common, role: "doctor", email: "doctor@example.test", specialty: "ENT", doctorVerificationStatus: "pending" });
  const patient = h.add("User", { ...common, role: "patient", email: "patient@example.test" });
  return { ...h, admin, doctor, patient, api: createAdminActions(h.db) };
};
test("concurrent identical approvals commit one decision, audit and notification", async () => {
  const h = setup(), args = { actorId: h.admin._id, targetId: h.doctor._id, status: "verified", specialty: "ENT" };
  const result = await Promise.all([h.api.verification(args), h.api.verification(args)]);
  assert.equal(h.state.User[1].doctorVerificationStatus, "verified"); assert.equal(h.state.User[1].isDoctorVerified, true);
  assert.equal(h.state.AuditLog.length, 1); assert.equal(h.state.Notification.length, 1); assert.equal(h.state.Notification[0].recipient, String(h.doctor._id));
  assert.equal(result[0].doctor.password, undefined); assert.equal(result[0].doctor.sessionVersion, undefined);
  assert.ok(h.stats.retries > 0);
});
test("rejection is atomic with its reason, clears legacy approval, and identical retry is a no-op", async () => {
  const h = setup(); h.state.User[1].isDoctorVerified = true;
  const args = { actorId: h.admin._id, targetId: h.doctor._id, status: "rejected", reason: "Synthetic details need correction" };
  await h.api.verification(args); await h.api.verification(args);
  assert.equal(h.state.User[1].isDoctorVerified, false); assert.equal(h.state.User[1].doctorVerificationReason, args.reason);
  assert.equal(h.state.Notification.length, 1); assert.equal(h.state.Notification[0].link, "/doctor/verification-pending"); assert.equal(h.state.AuditLog.length, 1);
});
for (const failAt of ["AuditLog", "Notification"]) test(`admin decision rolls back state and reason if ${failAt} fails`, async () => {
  const h = setup(); h.stats.failAt = failAt; const before = JSON.stringify(h.state);
  await assert.rejects(h.api.verification({ actorId: h.admin._id, targetId: h.doctor._id, status: "rejected", reason: "Synthetic correction required" }), /Injected/);
  assert.equal(JSON.stringify(h.state), before);
});
test("suspension revokes sessions once; reactivation and retries preserve revoked version", async () => {
  const h = setup(); h.state.User[2].sessionVersion = 8;
  const args = { actorId: h.admin._id, targetId: h.patient._id, accountStatus: "disabled" };
  await Promise.all([h.api.status(args), h.api.status(args)]);
  assert.equal(h.state.User[2].sessionVersion, 9); assert.equal(h.state.Notification.length, 1);
  await h.api.status({ ...args, accountStatus: "active" }); await h.api.status({ ...args, accountStatus: "active" });
  assert.equal(h.state.User[2].accountStatus, "active"); assert.equal(h.state.User[2].sessionVersion, 9); assert.equal(h.state.Notification.length, 2);
});
test("failed suspension notification cannot partly suspend or revoke sessions", async () => {
  const h = setup(); h.stats.failAt = "Notification"; const before = JSON.stringify(h.state);
  await assert.rejects(h.api.status({ actorId: h.admin._id, targetId: h.patient._id, accountStatus: "disabled" }), /Injected/);
  assert.equal(JSON.stringify(h.state), before);
});
test("admin service rejects cross-role, disabled actor, self-suspension and invalid decisions", async () => {
  const h = setup();
  await assert.rejects(h.api.status({ actorId: h.patient._id, targetId: h.doctor._id, accountStatus: "disabled" }), { status: 403 });
  await assert.rejects(h.api.status({ actorId: h.admin._id, targetId: h.admin._id, accountStatus: "disabled" }), { status: 409 });
  await assert.rejects(h.api.verification({ actorId: h.admin._id, targetId: h.doctor._id, status: "rejected", reason: "bad" }), { status: 400 });
  await assert.rejects(h.api.verification({ actorId: h.admin._id, targetId: h.doctor._id, status: "verified", specialty: "Invented" }), { status: 400 });
  h.state.User[0].accountStatus = "disabled";
  await assert.rejects(h.api.verification({ actorId: h.admin._id, targetId: h.doctor._id, status: "verified" }), { status: 403 });
  assert.equal(h.state.Notification.length, 0);
});
test("admin transaction support fails closed and uncertain commit retry emits no duplicate event", async () => {
  const h = setup(), args = { actorId: h.admin._id, targetId: h.doctor._id, status: "verified" };
  h.stats.unsupported = true; await assert.rejects(h.api.verification(args), { status: 503, code: "TRANSACTIONS_REQUIRED" }); assert.equal(h.state.Notification.length, 0);
  h.stats.unsupported = false; h.stats.unknownCommit = true;
  await assert.rejects(h.api.verification(args), { code: "ADMIN_OUTCOME_UNKNOWN" });
  await h.api.verification(args); assert.equal(h.state.Notification.length, 1); assert.equal(h.state.AuditLog.length, 1);
});
test("booking, rescheduling and cancellation emit exactly one event per recipient and committed transition", async () => {
  const h = setup(); Object.assign(h.state.User[1], { doctorVerificationStatus: "verified", availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "12:00", appointmentDurationMinutes: 30 })) });
  const api = createSchedulingService(h.db), args = { patientId: h.patient._id, body: { doctor: String(h.doctor._id), problem: "Synthetic", startAt: createStartAt("2035-01-02", "09:00").toISOString(), durationMinutes: 30, requestId: "synthetic-booking-request" } };
  const booked = await api.book(args); await api.book(args); assert.equal(h.state.Notification.length, 2);
  await api.reschedule({ appointmentId: booked.appointment._id, patientId: h.patient._id, body: { appointmentVersion: 0, startAt: createStartAt("2035-01-02", "10:00").toISOString(), durationMinutes: 30 } });
  const cancel = { appointmentId: booked.appointment._id, actorId: h.patient._id, actorRole: "patient", appointmentVersion: 1 };
  await api.cancel(cancel); await api.cancel(cancel);
  assert.equal(h.state.Notification.length, 6);
  assert.deepEqual(h.state.Notification.map(row => row.type), ["APPOINTMENT_BOOKED", "NEW_APPOINTMENT", "APPOINTMENT_RESCHEDULED", "APPOINTMENT_RESCHEDULED", "APPOINTMENT_CANCELLED", "APPOINTMENT_CANCELLED"]);
});
test("admin date boundaries include the full UTC end date and malformed pagination fails closed", () => {
  const range = dateRange({ dateFrom: "2030-01-01", dateTo: "2030-01-02" });
  assert.equal(range.$lte.toISOString(), "2030-01-02T23:59:59.999Z");
  for (const value of ["2030-02-30", "not-a-date"]) assert.throws(() => dateRange({ dateFrom: value }), { status: 400 });
  assert.throws(() => dateRange({ dateFrom: "2030-02-02", dateTo: "2030-01-01" }), { status: 400 });
  for (const value of ["Infinity", "1.5", "-1", "0"]) assert.throws(() => pageValues({ page: value }), { status: 400 });
  assert.deepEqual(pageValues({}), { page: 1, limit: 20 });
});
