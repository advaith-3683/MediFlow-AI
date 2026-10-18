const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Appointment = require("../models/Appointment");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const MedicalRecord = require("../models/MedicalRecord");
const AuditLog = require("../models/AuditLog");
const adminActions = require("../services/adminActions");
const adminRouter = require("../routes/admin");
const notificationRouter = require("../routes/notifications");
const authRouter = require("../routes/auth");
const appointmentsRouter = require("../routes/appointments");
const { errorHandler } = require("../middleware/errorHandler");
const { visibleRecordFilter } = require("../services/medicalFiles");
const ids = { patient: "507f1f77bcf86cd799439011", doctor: "507f1f77bcf86cd799439012", admin: "507f1f77bcf86cd799439013" };
const query = value => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const setup = async t => {
  const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = "synthetic-portal-http-secret";
  const accounts = Object.fromEntries(Object.entries(ids).map(([role, id]) => [id, { _id: id, role, accountStatus: "active", sessionVersion: 0, email: `${role}@example.test`, doctorVerificationStatus: "pending", name: "Synthetic" }]));
  let actor = ids.patient, fail = false;
  const rows = [ids.patient, ids.doctor].map((recipient, i) => ({ _id: `507f1f77bcf86cd79943902${i}`, recipient, title: "Synthetic event", message: "Synthetic", readAt: null, createdAt: new Date().toISOString() }));
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value || (value === null && row[key] == null));
  t.mock.method(User, "findById", id => query(accounts[String(id)]));
  const writes = [];
  t.mock.method(User, "findByIdAndUpdate", (id, update, options) => { assert.equal(options.runValidators, true); writes.push({ id, update }); const account = accounts[String(id)]; account.notificationPreferences ||= {}; for (const [key, value] of Object.entries(update.$set)) account.notificationPreferences[key.split(".")[1]] = value; return query(account); });
  t.mock.method(Notification, "find", filter => {
    if (fail) throw new Error("private-sensitive-provider-secret");
    let skip = 0, limit = Infinity;
    return { sort() { return this; }, skip(n) { skip = n; return this; }, limit(n) { limit = n; return this; }, lean: async () => rows.filter(row => matches(row, filter)).slice(skip, skip + limit) };
  });
  t.mock.method(Notification, "countDocuments", async filter => rows.filter(row => matches(row, filter)).length);
  t.mock.method(Notification, "findOneAndUpdate", async (filter, update) => { const row = rows.find(row => matches(row, filter)); if (row) Object.assign(row, update.$set); return row || null; });
  t.mock.method(Notification, "findOne", async filter => rows.find(row => matches(row, filter)) || null);
  t.mock.method(Notification, "updateMany", async (filter, update) => { for (const row of rows.filter(row => matches(row, filter))) Object.assign(row, update.$set); return {}; });
  t.mock.method(console, "error", () => {});
  const app = express(); app.use(express.json()); app.use("/notifications", notificationRouter); app.use("/admin", adminRouter); app.use("/auth", authRouter); app.use("/appointments", appointmentsRouter); app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const request = (path, method = "GET", body, authenticated = true, version = 0) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${jwt.sign({ userId: actor, role: "forged", sessionVersion: version }, process.env.JWT_SECRET)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { accounts, rows, writes, request, as: role => { actor = ids[role]; }, fail: () => { fail = true; } };
};
test("notifications list/count/read/read-all are recipient scoped, including cross-role guesses", async t => {
  const h = await setup(t);
  assert.equal((await h.request("/notifications", "GET", undefined, false)).status, 401);
  let response = await h.request("/notifications"); assert.equal(response.headers.get("cache-control"), "private, no-store"); let data = await response.json(); assert.equal(data.notifications.length, 1); assert.equal(data.unreadCount, 1);
  assert.equal((await h.request(`/notifications/${h.rows[1]._id}/read`, "PATCH")).status, 404);
  assert.equal((await h.request(`/notifications/${h.rows[0]._id}/read`, "PATCH")).status, 200); const originalRead = h.rows[0].readAt;
  assert.equal((await h.request(`/notifications/${h.rows[0]._id}/read`, "PATCH")).status, 200); assert.equal(h.rows[0].readAt, originalRead);
  await h.request("/notifications/read-all", "PATCH"); assert.equal(h.rows[1].readAt, null);
  h.as("doctor"); data = await (await h.request("/notifications")).json(); assert.equal(data.notifications[0].recipient, ids.doctor); assert.equal(data.unreadCount, 1);
});
test("notification pagination exposes older pages and rejects malformed limits", async t => {
  const h = await setup(t); h.rows.push({ ...h.rows[0], _id: "507f1f77bcf86cd799439029" });
  const first = await (await h.request("/notifications?limit=1")).json(); assert.equal(first.hasMore, true); assert.equal(first.unreadCount, 2);
  const second = await (await h.request("/notifications?limit=1&page=2")).json(); assert.equal(second.notifications.length, 1); assert.equal(second.hasMore, false);
  for (const value of ["Infinity", "-1", "1.5", "101"]) assert.equal((await h.request(`/notifications?limit=${value}`)).status, 400);
});
test("preferences persist on the authenticated account and reject mass assignment", async t => {
  const h = await setup(t); assert.deepEqual(await (await h.request("/notifications/preferences")).json(), { appointmentReminders: true, healthTips: true });
  assert.equal((await h.request("/notifications/preferences", "PATCH", { appointmentReminders: false })).status, 200);
  assert.equal((await (await h.request("/notifications/preferences")).json()).appointmentReminders, false); assert.equal(h.writes[0].id, ids.patient);
  for (const body of [{ role: "admin" }, { healthTips: "false" }, { recipient: ids.doctor, healthTips: true }, {}]) assert.equal((await h.request("/notifications/preferences", "PATCH", body)).status, 400);
  h.as("doctor"); assert.equal((await (await h.request("/notifications/preferences")).json()).appointmentReminders, true);
});
test("notification failures redact sensitive data", async t => {
  const h = await setup(t); h.fail(); const response = await h.request("/notifications"); assert.equal(response.status, 500); assert.doesNotMatch(JSON.stringify(await response.json()), /private-sensitive|provider-secret/);
});
test("all admin endpoints reject unauthenticated and non-admin sessions", async t => {
  const h = await setup(t);
  for (const role of ["patient", "doctor"]) { h.as(role); for (const path of ["dashboard", "users", "doctors", "appointments", "analytics", "audit-logs", "settings"]) assert.equal((await h.request(`/admin/${path}`)).status, 403); }
  assert.equal((await h.request("/admin/dashboard", "GET", undefined, false)).status, 401);
});
test("admin dashboard counts come from scoped database queries with canonical approval and visible records", async t => {
  const h = await setup(t); h.as("admin"); const userFilters = [];
  t.mock.method(User, "countDocuments", async filter => { userFilters.push(filter); return filter.role === "patient" ? 7 : filter.doctorVerificationStatus === "pending" ? 2 : filter.$or ? 1 : 3; });
  t.mock.method(Appointment, "countDocuments", async filter => !filter ? 9 : ({ scheduled: 4, completed: 3, cancelled: 2 })[filter.status]);
  t.mock.method(MedicalRecord, "countDocuments", async filter => { assert.deepEqual(filter, visibleRecordFilter()); return 5; });
  t.mock.method(Consultation, "countDocuments", async filter => { assert.deepEqual(filter, { status: "completed" }); return 3; });
  t.mock.method(Prescription, "countDocuments", async () => 2); t.mock.method(AuditLog, "find", () => query([]));
  const response = await h.request("/admin/dashboard"); assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.metrics.totalPatients, 7); assert.equal(data.metrics.totalAppointments, 9); assert.equal(data.metrics.pendingDoctors, 2); assert.equal(data.metrics.verifiedDoctors, 1); assert.equal(data.metrics.medicalRecords, 5);
  assert.deepEqual(userFilters.find(filter => filter.doctorVerificationStatus === "pending"), { role: "doctor", doctorVerificationStatus: "pending" });
});
test("analytics forwards actual aggregate results and filters completed consultations", async t => {
  const h = await setup(t); h.as("admin"); const fixture = [{ _id: "synthetic-category", count: 7 }];
  t.mock.method(Appointment, "aggregate", async pipeline => { assert.ok(pipeline.some(stage => stage.$group)); return fixture; });
  t.mock.method(User, "aggregate", async pipeline => { assert.ok(["patient", "doctor"].includes(pipeline[0].$match.role)); return fixture; });
  t.mock.method(Consultation, "aggregate", async pipeline => { assert.equal(pipeline[0].$match.status, "completed"); return fixture; });
  t.mock.method(Prescription, "countDocuments", async () => 4);
  const data = await (await h.request("/admin/analytics")).json(); assert.deepEqual(data.appointmentsByStatus, fixture); assert.deepEqual(data.patientRegistrations, fixture); assert.equal(data.prescriptionCount, 4);
});
test("admin mutation routes dispatch authenticated actor and scoped target only", async t => {
  const h = await setup(t); h.as("admin"); const calls = [];
  t.mock.method(adminActions, "verification", async args => { calls.push(args); return { message: "synthetic" }; });
  t.mock.method(adminActions, "status", async args => { calls.push(args); return { message: "synthetic" }; });
  assert.equal((await h.request(`/admin/doctors/${ids.doctor}/verification`, "PATCH", { actorId: ids.patient, status: "rejected", reason: "Synthetic correction" })).status, 200);
  assert.equal((await h.request(`/admin/users/${ids.patient}/status`, "PATCH", { accountStatus: "disabled" })).status, 200);
  assert.equal(calls[0].actorId, ids.admin); assert.equal(calls[0].targetId, ids.doctor); assert.equal(calls[1].targetId, ids.patient);
});
test("patient dashboard excludes hidden storage states and preserves patient ownership", async t => {
  const h = await setup(t);
  for (const Model of [Appointment, Prescription, Consultation]) t.mock.method(Model, "countDocuments", async filter => { assert.equal(filter.patient, ids.patient); return 2; });
  t.mock.method(MedicalRecord, "countDocuments", async filter => { assert.deepEqual(filter, { patient: ids.patient, ...visibleRecordFilter() }); return 1; });
  t.mock.method(Appointment, "findOne", filter => { assert.equal(filter.patient, ids.patient); assert.equal(filter.status, "scheduled"); return query(null); });
  const response = await h.request("/appointments/dashboard"); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.medicalRecords, 1); assert.equal(data.nextAppointment, null);
});
test("admin invalid date filters fail before query and audit visibility preserves database output", async t => {
  const h = await setup(t); h.as("admin"); const fixture = [{ _id: "synthetic-audit", action: "DOCTOR_VERIFIED", metadata: { status: "verified" } }];
  t.mock.method(AuditLog, "find", filter => { assert.equal(filter.action, "DOCTOR_VERIFIED"); assert.equal(filter.createdAt.$lte.toISOString(), "2030-01-02T23:59:59.999Z"); return query(fixture); });
  t.mock.method(AuditLog, "countDocuments", async () => 1);
  assert.equal((await h.request("/admin/audit-logs?dateFrom=invalid")).status, 400);
  assert.equal((await h.request("/admin/appointments?dateFrom=2030-02-30")).status, 400);
  assert.equal((await h.request("/admin/users?page=1.5")).status, 400);
  const data = await (await h.request("/admin/audit-logs?action=DOCTOR_VERIFIED&dateTo=2030-01-02")).json(); assert.deepEqual(data.logs, fixture); assert.equal(data.total, 1);
});
test("session refresh reflects approval/rejection and suspension invalidates old JWT even after reactivation", async t => {
  const h = await setup(t); h.as("doctor"); h.accounts[ids.doctor].doctorVerificationStatus = "verified";
  assert.equal((await (await h.request("/auth/session")).json()).user.doctorVerificationStatus, "verified");
  h.accounts[ids.doctor].doctorVerificationStatus = "rejected"; h.accounts[ids.doctor].doctorVerificationReason = "Synthetic correction";
  let data = await (await h.request("/auth/session")).json(); assert.equal(data.user.doctorVerificationStatus, "rejected"); assert.equal(data.user.doctorVerificationReason, "Synthetic correction");
  h.accounts[ids.doctor].accountStatus = "disabled"; h.accounts[ids.doctor].sessionVersion = 1;
  assert.equal((await h.request("/auth/session")).status, 401);
  h.accounts[ids.doctor].accountStatus = "active"; assert.equal((await h.request("/auth/session")).status, 401);
  assert.equal((await h.request("/auth/session", "GET", undefined, true, 1)).status, 200);
});
