const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const Notification = require("../models/Notification");
const { errorHandler } = require("../middleware/errorHandler");
const { createStartAt, localDateKey } = require("../services/appointmentDomain");
const authRouter = require("../routes/auth");
const aiRouter = require("../routes/ai");
const appointmentsRouter = require("../routes/appointments");
const scheduling = require("../services/scheduling");
const { harness } = require("./helpers/schedulingHarness.cjs");

// Actual HTTP routes/middleware with deterministic provider and DB adapters.
// No server.js, dotenv, MongoDB connection, seed or integration harness.
const patientId = "507f1f77bcf86cd799439011", doctorId = "507f1f77bcf86cd799439012";
const original = {};
let server, baseUrl, doctors, busy, writes, queries, patient, provider, selectedDoctor, booking;
const query = (value) => ({ select() { return this; }, populate() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
before(async () => {
  for (const key of ["JWT_SECRET", "GEMINI_API_KEY", "CLINIC_TIMEZONE_OFFSET"]) original[key] = process.env[key];
  process.env.JWT_SECRET = "synthetic-http-test-secret-never-a-production-secret";
  process.env.GEMINI_API_KEY = "synthetic-http-test-provider-value";
  process.env.CLINIC_TIMEZONE_OFFSET = "+05:30";
  const app = express(); app.use(express.json());
  app.use("/api/auth", authRouter); app.use("/api/ai", aiRouter); app.use("/api/appointments", appointmentsRouter); app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
beforeEach((t) => {
  patient = { _id: patientId, role: "patient", isVerified: false, accountStatus: "active" };
  selectedDoctor = { _id: doctorId, name: "Fixture dermatologist", email: "fixture@example.test", role: "doctor", specialty: "Dermatologist", isVerified: false, accountStatus: "active", doctorVerificationStatus: "verified", isDoctorVerified: true,
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 30 })), unavailableDates: [] };
  doctors = [selectedDoctor]; busy = []; writes = []; queries = []; booking = null;
  provider = { priority: "NORMAL", specialties: ["Dermatologist"], summary: "Synthetic rash fixture", recommendation: "Seek a qualified clinician's assessment." };
  t.mock.method(scheduling, "book", async args => {
    const h = harness(); h.state.User.push({ ...patient });
    if (selectedDoctor) h.state.User.push({ ...selectedDoctor });
    const result = await scheduling.createSchedulingService(h.db).book(args);
    writes.push(...h.state.Appointment); return result;
  });
  t.mock.method(User, "findById", () => query(patient));
  t.mock.method(User, "find", (filter) => { queries.push(filter); return query(doctors); });
  t.mock.method(User, "findOne", (filter) => {
    queries.push(filter);
    assert.equal(filter.role, "doctor"); assert.equal(filter.accountStatus, "active"); assert.equal(filter.isVerified, undefined);
    assert.deepEqual(filter.isDemo, { $ne: true });
    return query(selectedDoctor);
  });
  t.mock.method(Appointment, "find", (filter) => { queries.push(filter); return query(busy); });
  t.mock.method(Appointment, "exists", async () => null);
  t.mock.method(Appointment, "create", async (value) => { writes.push(value); booking = { _id: "507f1f77bcf86cd799439013", ...value }; return booking; });
  t.mock.method(Appointment, "findById", () => query(booking));
  t.mock.method(Notification, "create", async () => ({}));
  t.mock.method(axios, "post", async () => ({ data: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(provider) }] } }] } }));
});
const request = async (path, method = "GET", body, authenticated = true) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${jwt.sign({ userId: patientId }, process.env.JWT_SECRET)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};
test("specialty contract is public and includes dental and eye care without exposing configuration", async () => {
  const result = await request("/api/auth/specialties", "GET", undefined, false);
  assert.equal(result.status, 200); assert.ok(result.body.includes("Dentist")); assert.ok(result.body.includes("Ophthalmologist"));
});
test("patient triage HTTP response contains actual matched records and reason", async () => {
  const result = await request("/api/ai/triage", "POST", { problem: "Synthetic skin rash" });
  assert.equal(result.status, 200); assert.equal(result.body.doctors[0]._id, doctorId); assert.equal(result.body.specialties[0], "Dermatologist");
  assert.match(result.body.doctors[0].recommendationReason, /Dermatologist/);
});
test("manual discovery applies requested specialty instead of returning the first approved doctor", async () => {
  const result = await request("/api/appointments/doctors?specialty=Dentist");
  assert.equal(result.status, 200); assert.deepEqual(result.body, []);
  assert.deepEqual(queries[0].specialty, { $in: ["Dentist"] });
});
test("unknown manual specialty is explicitly rejected without database discovery", async () => {
  assert.equal((await request("/api/appointments/doctors?specialty=Unknown")).status, 400);
  assert.equal(queries.length, 0);
});
test("emergency triage HTTP response has no routine doctors and booking rejects emergency priority", async () => {
  provider.priority = "EMERGENCY";
  const result = await request("/api/ai/triage", "POST", { problem: "Synthetic potentially serious chest pain" });
  assert.equal(result.status, 200); assert.deepEqual(result.body.doctors, []); assert.deepEqual(result.body.specialties, []);
  assert.equal(queries.length, 0);
  const booked = await request("/api/appointments", "POST", { doctor: doctorId, problem: "Synthetic concern", priority: "emergency" });
  assert.equal(booked.status, 409); assert.equal(booked.body.code, "EMERGENCY_CARE_REQUIRED"); assert.equal(writes.length, 0);
});
test("slot retrieval excludes an overlapping patient appointment and rejects invalid calendar dates", async () => {
  const date = localDateKey(new Date(Date.now() + 7 * 86400000));
  const first = createStartAt(date, "09:00").toISOString();
  busy = [{ startAt: first, durationMinutes: 30 }];
  const result = await request(`/api/appointments/doctors/${doctorId}/slots?date=${date}`);
  assert.equal(result.status, 200); assert.ok(result.body.length); assert.equal(result.body.some((slot) => slot.startAt === first), false);
  assert.equal((await request(`/api/appointments/doctors/${doctorId}/slots?date=2030-02-30`)).status, 400);
});
test("reschedule slots may exclude only the patient's own scheduled appointment with that doctor", async (t) => {
  const id = "507f1f77bcf86cd799439013";
  const date = localDateKey(new Date(Date.now() + 7 * 86400000));
  t.mock.method(Appointment, "exists", async filter => { assert.deepEqual(filter, { _id: id, patient: patientId, doctor: doctorId, status: "scheduled" }); return { _id: id }; });
  assert.equal((await request(`/api/appointments/doctors/${doctorId}/slots?date=${date}&excludeAppointmentId=${id}`)).status, 200);
  assert.deepEqual(queries.at(-1)._id, { $ne: id });
  t.mock.method(Appointment, "exists", async () => null);
  assert.equal((await request(`/api/appointments/doctors/${doctorId}/slots?date=${date}&excludeAppointmentId=${id}`)).status, 404);
});
test("manual booking uses selected DB doctor specialty and authenticated patient", async () => {
  const date = localDateKey(new Date(Date.now() + 7 * 86400000));
  const result = await request("/api/appointments", "POST", { doctor: doctorId, patient: "forged", specialty: "forged", problem: "Synthetic concern", startAt: createStartAt(date, "09:00").toISOString(), durationMinutes: 30 });
  assert.equal(result.status, 201); assert.equal(writes[0].patient, patientId); assert.equal(writes[0].specialty, "Dermatologist");
});
test("booking cannot use an ineligible doctor", async () => {
  selectedDoctor = null;
  const result = await request("/api/appointments", "POST", { doctor: doctorId, problem: "Synthetic concern", startAt: createStartAt(localDateKey(new Date(Date.now() + 7 * 86400000)), "09:00").toISOString(), durationMinutes: 30 });
  assert.equal(result.status, 404); assert.equal(writes.length, 0);
});
test("recommendation routes still require patient authentication", async () => {
  assert.equal((await request("/api/ai/triage", "POST", { problem: "Synthetic concern" }, false)).status, 401);
  patient.role = "doctor";
  assert.equal((await request("/api/appointments/doctors?specialty=Dermatologist")).status, 403);
});
test("non-text triage input is rejected before provider or doctor lookup", async () => {
  const result = await request("/api/ai/triage", "POST", { problem: { value: "Synthetic concern" } });
  assert.equal(result.status, 400); assert.equal(queries.length, 0);
});
