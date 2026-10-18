const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const Consultation = require("../models/Consultation");
const router = require("../routes/doctorAppointments");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { errorHandler } = require("../middleware/errorHandler");

// Exercise HTTP middleware and routes without importing server.js, loading .env,
// connecting to MongoDB, or running the destructive integration-test harness.
const doctorId = "507f1f77bcf86cd799439011";
const otherDoctorId = "507f1f77bcf86cd799439012";
const appointmentId = "507f1f77bcf86cd799439013";
const patientId = "507f1f77bcf86cd799439014";
const secret = "doctor-appointment-regression-tests-only";
const originalSecret = process.env.JWT_SECRET;
let server;
let baseUrl;
let user;
let appointment;
let appointmentCalls;
let updates;
let race;

const query = (value) => ({
  session() { return this; }, select() { return this; }, populate() { return this; }, sort() { return this; },
  lean() { return Promise.resolve(value); },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

before(async () => {
  process.env.JWT_SECRET = secret;
  const app = express();
  app.use(express.json());
  app.use("/api/doctor/appointments", router);
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/doctor/appointments`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

beforeEach((t) => {
  user = { _id: doctorId, email: "doctor@example.test", role: "doctor", isVerified: true,
    accountStatus: "active", doctorVerificationStatus: "verified", isDoctorVerified: true,
    name: "Test Doctor", specialty: "General Physician" };
  appointment = { _id: appointmentId, doctor: doctorId, patient: patientId, status: "scheduled" };
  appointmentCalls = [];
  updates = [];
  race = false;
  t.mock.method(mongoose, "startSession", async () => ({ withTransaction: async callback => callback({}), endSession: async () => {} }));
  t.mock.method(AuditLog.prototype, "save", async function () { return this; });
  t.mock.method(Notification.prototype, "save", async function () { return this; });
  t.mock.method(User, "findOneAndUpdate", async () => user.accountStatus !== "disabled" && (user.doctorVerificationStatus === "verified" || (user.doctorVerificationStatus === undefined && user.isDoctorVerified)) ? user : null);
  t.mock.method(User, "findById", (id) => {
    assert.equal(id, doctorId);
    return query(user);
  });
  t.mock.method(User, "findOne", (filter) => {
    assert.equal(filter._id, doctorId);
    assert.equal(filter.role, "doctor");
    assert.equal(filter.isVerified, undefined);
    assert.deepEqual(filter.accountStatus, { $ne: "disabled" });
    assert.deepEqual(filter.$or, [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }]);
    return query(user.role === "doctor" && user.accountStatus !== "disabled" &&
      (user.doctorVerificationStatus === "verified" || (user.doctorVerificationStatus === undefined && user.isDoctorVerified === true)) ? user : null);
  });
  t.mock.method(Appointment, "find", (filter) => {
    appointmentCalls.push(filter);
    assert.equal(filter.doctor, doctorId);
    return query([]);
  });
  t.mock.method(Appointment, "countDocuments", (filter) => {
    appointmentCalls.push(filter);
    assert.equal(filter.doctor, doctorId);
    return Promise.resolve(0);
  });
  t.mock.method(Appointment, "findOne", (filter) => {
    appointmentCalls.push(filter);
    assert.deepEqual(filter, { _id: appointmentId, doctor: doctorId });
    return query(appointment && appointment.doctor === filter.doctor ? appointment : null);
  });
  t.mock.method(Appointment, "findOneAndUpdate", async (filter, update, options) => {
    updates.push({ filter, update, options });
    assert.equal(String(filter._id), appointmentId); assert.equal(filter.status, "scheduled");
    assert.deepEqual(filter.$or, [{ __v: 0 }, { __v: { $exists: false } }]);
    assert.deepEqual(update, { $set: { status: "cancelled" }, $inc: { __v: 1 } });
    assert.ok(options.session); assert.equal(options.new, true); assert.equal(options.runValidators, true);
    if (race || !appointment || appointment.status !== filter.status) return null;
    appointment = { ...appointment, status: "cancelled", __v: 1 };
    return { ...appointment, toObject: () => ({ ...appointment }) };
  });
  t.mock.method(Consultation, "countDocuments", (filter) => {
    assert.equal(filter.doctor, doctorId);
    return Promise.resolve(0);
  });
  t.mock.method(Consultation, "distinct", (_field, filter) => {
    assert.equal(filter.doctor, doctorId);
    return Promise.resolve([]);
  });
  t.mock.method(Consultation, "find", () => query([]));
});

afterEach((t) => t.mock.restoreAll());

const request = async (path, method = "GET", body, authenticated = true) => {
  const headers = { "content-type": "application/json" };
  if (authenticated) headers.authorization = `Bearer ${jwt.sign({ userId: doctorId }, secret)}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body?.status === "cancelled" ? { appointmentVersion: 0, ...body } : body) }) });
  return { status: response.status, body: await response.json() };
};

const endpoints = [
  ["/dashboard", "GET"], ["/", "GET"], [`/${appointmentId}`, "GET"],
  [`/${appointmentId}/status`, "PATCH", { status: "cancelled" }],
];

for (const state of ["pending", "rejected", "disabled"]) {
  for (const [path, method, body] of endpoints) {
    test(`${state} doctor is denied ${method} ${path}`, async () => {
      if (state === "disabled") user.accountStatus = "disabled";
      else { user.doctorVerificationStatus = state; user.isDoctorVerified = false; }
      const result = await request(path, method, body);
      assert.equal(result.status, 403);
      assert.equal(appointmentCalls.length, 0);
      assert.equal(updates.length, 0);
      assert.equal(appointment.status, "scheduled");
    });
  }
}

test("approved doctor can read dashboard, own list and own appointment", async () => {
  for (const path of ["/dashboard", "/", `/${appointmentId}`]) {
    assert.equal((await request(path)).status, 200);
  }
});

test("existing legacy doctor approval remains supported", async () => {
  user.doctorVerificationStatus = undefined;
  assert.equal((await request(`/${appointmentId}`)).status, 200);
});
for (const status of ["pending", "rejected"]) test(`explicit ${status} cannot be overridden by legacy approval`, async () => {
  user.doctorVerificationStatus = status; user.isDoctorVerified = true;
  assert.equal((await request(`/${appointmentId}`)).status, 403);
  assert.equal(appointmentCalls.length, 0);
});

test("approved doctor can cancel only their own scheduled appointment", async () => {
  const result = await request(`/${appointmentId}/status`, "PATCH", { status: "cancelled", doctor: otherDoctorId, patient: otherDoctorId });
  assert.equal(result.status, 200);
  assert.equal(result.body.appointment.status, "cancelled");
  assert.equal(result.body.appointment.doctor, doctorId);
  assert.equal(result.body.appointment.patient, patientId);
  assert.equal(updates.length, 1);
});

test("unrelated approved doctor cannot read or cancel another doctor's appointment", async () => {
  appointment.doctor = otherDoctorId;
  assert.equal((await request(`/${appointmentId}`)).status, 404);
  assert.equal((await request(`/${appointmentId}/status`, "PATCH", { status: "cancelled" })).status, 404);
  assert.equal(updates.length, 0);
});

for (const status of ["completed", "cancelled"]) {
  test(`cannot cancel a ${status} appointment`, async () => {
    appointment.status = status;
    assert.equal((await request(`/${appointmentId}/status`, "PATCH", { status: "cancelled" })).status, 409);
    assert.equal(appointment.status, status);
    assert.equal(updates.length, 0);
  });
}

test("conditional cancellation rejects a concurrent state change", async () => {
  race = true;
  assert.equal((await request(`/${appointmentId}/status`, "PATCH", { status: "cancelled" })).status, 409);
  assert.equal(updates.length, 1);
});

test("generic status endpoint cannot bypass clinical completion", async () => {
  const result = await request(`/${appointmentId}/status`, "PATCH", { status: "completed", consultation: { status: "completed" } });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /clinical completion workflow/);
  assert.equal(appointmentCalls.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(appointment.status, "scheduled");
});

test("invalid or missing status cannot mutate appointments", async () => {
  for (const body of [{}, { status: "scheduled" }, { status: "pending" }, { status: null }]) {
    assert.equal((await request(`/${appointmentId}/status`, "PATCH", body)).status, 400);
  }
  assert.equal(updates.length, 0);
});

test("invalid IDs return 400 without querying appointments", async () => {
  assert.equal((await request("/invalid")).status, 400);
  assert.equal((await request("/invalid/status", "PATCH", { status: "cancelled" })).status, 400);
  assert.equal(appointmentCalls.length, 0);
});

test("missing JWT and patient role are denied", async () => {
  assert.equal((await request(`/${appointmentId}`, "GET", undefined, false)).status, 401);
  user.role = "patient";
  assert.equal((await request(`/${appointmentId}`)).status, 403);
  assert.equal(appointmentCalls.length, 0);
});

test("approved doctor without verified email can access own appointment", async () => {
  user.isVerified = false;
  assert.equal((await request(`/${appointmentId}`)).status, 200);
});
