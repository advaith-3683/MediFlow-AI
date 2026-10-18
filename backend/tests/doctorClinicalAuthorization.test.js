const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const router = require("../routes/doctorClinical");

// Real HTTP/auth middleware, mocked account lookups, and no database session.
const doctorId = "507f1f77bcf86cd799439011";
const secret = "clinical-authorization-regression-tests-only";
const originalSecret = process.env.JWT_SECRET;
let server; let baseUrl; let user;
before(async () => {
  process.env.JWT_SECRET = secret;
  const app = express(); app.use(express.json());
  app.use("/clinical", router);
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/clinical/appointments/507f1f77bcf86cd799439012/complete`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
beforeEach((t) => {
  user = { _id: doctorId, role: "doctor", isVerified: true, accountStatus: "active", doctorVerificationStatus: "verified", isDoctorVerified: true };
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "findOne", () => Promise.resolve(user.doctorVerificationStatus === "verified" && user.accountStatus !== "disabled" ? user : null));
  t.mock.method(mongoose, "startSession", () => assert.fail("Rejected HTTP request must not open a transaction"));
});
const request = (token) => fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: "{}" });
for (const state of ["missing-token", "patient", "pending", "rejected", "pending-legacy", "rejected-legacy", "disabled"]) {
  test(`clinical completion HTTP route denies ${state}`, async () => {
    if (state === "patient") user.role = "patient";
    if (state === "unverified") user.isVerified = false;
    if (["pending", "rejected"].includes(state)) { user.doctorVerificationStatus = state; user.isDoctorVerified = false; }
    if (state.endsWith("-legacy")) { user.doctorVerificationStatus = state.split("-")[0]; user.isDoctorVerified = true; }
    if (state === "disabled") user.accountStatus = "disabled";
    const token = state === "missing-token" ? null : jwt.sign({ userId: doctorId }, secret);
    assert.equal((await request(token)).status, state === "missing-token" ? 401 : 403);
  });
}
