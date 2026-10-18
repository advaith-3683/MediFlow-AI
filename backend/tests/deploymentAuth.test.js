const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { bootstrapValues, bootstrapAdmin } = require("../services/adminBootstrap");
const { errorHandler } = require("../middleware/errorHandler");
let records, server, base;
const original = {};
const keys = ["JWT_SECRET", "AUTH_EMAIL_ENABLED", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"];
const query = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(v => matches(row, v));
  if (value && typeof value === "object" && "$exists" in value) return (row[key] !== undefined) === value.$exists;
  if (value && typeof value === "object" && "$ne" in value) return row[key] !== value.$ne;
  return String(row[key]) === String(value);
});
before(async () => {
  for (const key of keys) original[key] = process.env[key];
  process.env.JWT_SECRET = "synthetic-deployment-test-secret";
  for (const key of keys.filter(key => key !== "JWT_SECRET")) delete process.env[key];
  const app = express(); app.use(express.json());
  app.use("/auth", require("../routes/auth"));
  app.use("/admin", require("../routes/admin"));
  app.use("/clinical", require("../routes/doctorClinical"));
  app.use(errorHandler);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
});
beforeEach(t => {
  records = [];
  t.mock.method(require("mongoose"), "startSession", () => assert.fail("Tests must inject a disposable transaction mock"));
  const persist = async function () {
    const error = this.validateSync?.(); if (error) throw error;
    const row = this.toObject ? this.toObject() : this;
    row.save = persist; if (!records.some(r => String(r._id) === String(row._id))) records.push(row);
    return this;
  };
  t.mock.method(User.prototype, "save", persist);
  t.mock.method(User, "findOne", filter => query(records.find(r => matches(r, filter)) || null));
  t.mock.method(User, "findById", id => query(records.find(r => String(r._id) === String(id)) || null));
  t.mock.method(User, "create", async values => { const user = new User(values); await user.save(); return user; });
  t.mock.method(User, "exists", async filter => records.find(r => matches(r, filter)) || null);
  t.mock.method(AuditLog, "create", async value => value);
  t.mock.method(Notification, "create", async value => value);
  t.mock.method(axios, "post", async () => assert.fail("No real email/provider calls allowed"));
  t.mock.method(console, "error", () => {});
});
const request = async (path, body, token, method = body ? "POST" : "GET") => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const signup = (role = "patient", extra = {}) => request("/auth/signup", { name: "Synthetic Account", email: `${role}@example.test`, phone: "1234567890", password: "synthetic-password", role,
  ...(role === "doctor" ? { specialty: "ENT", qualifications: ["Synthetic qualification"], languages: ["English"], experienceYears: 2, bio: "Synthetic professional details" } : {}), ...extra });
test("patient signup and login work without email provider and never verify ownership", async () => {
  const result = await signup(); assert.equal(result.status, 200);
  assert.equal(result.body.user.emailVerified, false); assert.equal(result.body.user.isVerified, false);
  assert.equal(records[0].isVerified, false); assert.notEqual(records[0].password, "synthetic-password");
  assert.equal(await bcrypt.compare("synthetic-password", records[0].password), true);
  assert.equal(jwt.verify(result.body.token, process.env.JWT_SECRET).sessionVersion, 0);
  assert.equal((await request("/auth/profile", null, result.body.token)).status, 200);
  const login = await request("/auth/login", { email: "PATIENT@example.test", password: "synthetic-password" });
  assert.equal(login.status, 200); assert.equal(login.body.user.emailVerified, false);
  assert.equal((await request("/auth/session", null, login.body.token)).status, 200);
});
test("new doctor remains pending and cannot use clinical routes even with forged approval inputs", async () => {
  const result = await signup("doctor", { isVerified: true, isDoctorVerified: true, doctorVerificationStatus: "verified" });
  assert.equal(result.status, 200); assert.equal(result.body.user.doctorVerificationStatus, "pending");
  assert.equal(result.body.user.emailVerified, false); assert.equal(records[0].isDoctorVerified, false);
  assert.equal((await request("/clinical/profile", null, result.body.token)).status, 403);
  const login = await request("/auth/login", { email: "doctor@example.test", password: "synthetic-password" });
  assert.equal(login.status, 200); assert.equal(login.body.user.doctorVerificationStatus, "pending");
});
test("only admin may approve doctor; approved doctor works without verified email", async t => {
  const doctor = await signup("doctor"); const patient = await signup(); const id = doctor.body.user.id;
  assert.equal((await request(`/admin/doctors/${id}/verification`, { status: "verified" }, patient.body.token, "PATCH")).status, 403);
  assert.equal((await request(`/admin/doctors/${id}/verification`, { status: "verified" }, doctor.body.token, "PATCH")).status, 403);
  const admin = await User.create({ name: "Synthetic Admin", email: "admin@example.test", phone: "1234567890", password: await bcrypt.hash("synthetic-admin-password", 10), role: "admin", isVerified: false });
  const token = jwt.sign({ userId: String(admin._id), sessionVersion: 0 }, process.env.JWT_SECRET);
  const h = require("./helpers/schedulingHarness.cjs").harness();
  h.state.User.push(...JSON.parse(JSON.stringify(records)));
  const actions = require("../services/adminActions");
  const service = actions.createAdminActions(h.db);
  t.mock.method(actions, "verification", async args => {
    const result = await service.verification(args);
    for (const row of h.state.User) Object.assign(records.find(record => String(record._id) === String(row._id)), row);
    return result;
  });
  assert.equal((await request(`/admin/doctors/${id}/verification`, { status: "verified" }, token, "PATCH")).status, 200);
  const refreshed = await request("/auth/session", null, doctor.body.token);
  assert.equal(refreshed.body.user.doctorVerificationStatus, "verified"); assert.equal(refreshed.body.user.emailVerified, false);
  assert.equal((await request("/clinical/profile", null, doctor.body.token)).status, 200);
  records.find(r => String(r._id) === id).doctorVerificationStatus = "rejected";
  assert.equal((await request("/clinical/profile", null, doctor.body.token)).status, 403);
});
test("incorrect password, missing authentication and disabled accounts remain denied", async () => {
  const result = await signup();
  assert.equal((await request("/auth/login", { email: "patient@example.test", password: "incorrect" })).status, 401);
  assert.equal((await request("/auth/profile")).status, 401);
  assert.equal((await request("/auth/profile", null, "invalid-token")).status, 401);
  records[0].accountStatus = "disabled";
  assert.equal((await request("/auth/profile", null, result.body.token)).status, 403);
  assert.equal((await request("/auth/login", { email: "patient@example.test", password: "synthetic-password" })).status, 403);
});
test("verified-email accounts retain login compatibility and verification state", async () => {
  await signup(); records[0].isVerified = true;
  const result = await request("/auth/login", { email: "patient@example.test", password: "synthetic-password" });
  assert.equal(result.status, 200); assert.equal(result.body.user.emailVerified, true); assert.equal(records[0].isVerified, true);
});
test("public signup rejects admin role, weak passwords and duplicate unverified email", async () => {
  assert.equal((await signup("admin")).status, 400);
  assert.equal((await signup("patient", { password: "short" })).status, 400);
  assert.equal((await signup("patient", { password: "é".repeat(40) })).status, 400);
  await signup(); const hash = records[0].password;
  assert.equal((await signup("patient", { password: "another-password" })).status, 409);
  assert.equal(records[0].password, hash); assert.equal(records.length, 1);
});
test("optional OTP and recovery endpoints fail closed by default without writes", async () => {
  for (const path of ["resend-otp", "verify-otp", "forgot-password", "reset-password"]) {
    const result = await request(`/auth/${path}`, { email: "synthetic@example.test", otp: "123456", password: "synthetic-password" });
    assert.equal(result.status, 503); assert.equal(result.body.code, "EMAIL_FEATURE_DISABLED");
  }
  assert.equal(records.length, 0);
});
test("enabled recovery still requires configured email, signup does not", async () => {
  process.env.AUTH_EMAIL_ENABLED = "true";
  try { assert.equal((await signup()).status, 200); const result = await request("/auth/forgot-password", { email: "patient@example.test" }); assert.equal(result.status, 503); assert.equal(result.body.code, "EMAIL_NOT_CONFIGURED"); }
  finally { delete process.env.AUTH_EMAIL_ENABLED; }
});
test("admin bootstrap works on empty mocked database without fabricating email ownership", async () => {
  const values = bootstrapValues({ MONGO_URI: "mongodb://unused.invalid/test", ADMIN_EMAIL: "admin@example.test", ADMIN_NAME: "Synthetic Admin", ADMIN_PHONE: "1234567890", ADMIN_PASSWORD: "synthetic-admin-password" });
  assert.equal((await bootstrapAdmin(User, values)).created, true); assert.equal(records[0].role, "admin"); assert.equal(records[0].isVerified, false);
  assert.equal(await bcrypt.compare(values.password, records[0].password), true);
  const hash = records[0].password; records[0].accountStatus = "disabled";
  assert.equal((await bootstrapAdmin(User, values)).created, false); assert.equal(records[0].password, hash); assert.equal(records[0].accountStatus, "disabled");
});
test("bootstrap refuses role escalation and missing or weak configuration", async () => {
  await signup();
  await assert.rejects(bootstrapAdmin(User, { email: "patient@example.test" }), /refusing to elevate/);
  assert.throws(() => bootstrapValues({}), /Configure/);
  assert.equal(records[0].role, "patient");
});
