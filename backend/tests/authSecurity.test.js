const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const express = require("express");
const User = require("../models/User");
const { setOtp } = require("../utils/otp");
const { issueOtp, consumeOtp } = require("../services/authSecurity");
const { sendOtpEmail } = require("../services/emailService");
const auth = require("../middleware/authMiddleware");
const router = require("../routes/auth");
const { errorHandler } = require("../middleware/errorHandler");
let state, sent, savedEnv;
const keys = ["JWT_SECRET", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "NODE_ENV", "DEV_SHOW_OTP", "AUTH_EMAIL_ENABLED"];
const match = (filter) => Object.entries(filter).every(([key, value]) => {
  if (key === "$or") return value.some(match);
  const actual = state[key];
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, rhs]) =>
    op === "$ne" ? actual !== rhs : op === "$lt" ? actual < rhs : op === "$lte" ? actual <= rhs : op === "$gt" ? actual > rhs : false);
  return value === null ? actual == null : String(actual) === String(value);
});
const update = (values) => { Object.assign(state, values.$set); for (const [key, inc] of Object.entries(values.$inc || {})) state[key] = (state[key] || 0) + inc; };
beforeEach((t) => {
  savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { AUTH_EMAIL_ENABLED: "true", JWT_SECRET: "unit-test-auth-secret", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "synthetic-test-key", EMAIL_FROM: "unit@example.test", NODE_ENV: "production", DEV_SHOW_OTP: "true" });
  state = { _id: "507f1f77bcf86cd799439011", name: "Fixture", email: "fixture@example.test", role: "doctor", isVerified: false, accountStatus: "active", sessionVersion: 0, otpAttempts: 0 };
  sent = [];
  t.mock.method(axios, "post", async (url, body, options) => { sent.push({ url, body, options }); return { data: { id: "provider-test-receipt" } }; });
  t.mock.method(User, "findOneAndUpdate", async (filter, values) => { if (!match(filter)) return null; update(values); return { ...state }; });
  t.mock.method(User, "updateOne", async (filter, values) => { if (!match(filter)) return { modifiedCount: 0 }; update(values); return { modifiedCount: 1 }; });
  t.mock.method(User, "findById", () => ({ select: async () => ({ ...state }) }));
  t.mock.method(User, "findOne", () => ({ select: async () => ({ ...state }) }));
});
afterEach(() => { for (const key of keys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });
const prepare = (purpose = "signup") => { setOtp(state, purpose, "123456"); state.otpDeliveryState = "sent"; state.isVerified = purpose === "password-reset"; return { ...state }; };
test("successful issuance sends real adapter payload and activates hashed code only", async () => {
  const result = await issueOtp(state, "signup");
  assert.deepEqual(result, { delivery: "provider-accepted" }); assert.equal(state.otpDeliveryState, "sent");
  assert.equal(state.otp, null); assert.match(state.otpHash, /^[a-f0-9]{64}$/);
  assert.equal(sent[0].url, "https://api.resend.com/emails"); assert.ok(sent[0].options.headers["Idempotency-Key"]);
  assert.equal(JSON.stringify(result).includes("Otp"), false);
});
test("missing provider fails without reserving or sending an OTP", async () => {
  delete process.env.EMAIL_PROVIDER;
  await assert.rejects(issueOtp(state, "signup"), { code: "EMAIL_NOT_CONFIGURED" }); assert.equal(sent.length, 0); assert.equal(state.otpHash, undefined);
});
test("provider failure invalidates code, retains cooldown and redacts provider error", async (t) => {
  t.mock.method(axios, "post", async () => { throw new Error("sensitive provider payload"); });
  await assert.rejects(issueOtp(state, "signup"), error => error.code === "EMAIL_DELIVERY_FAILED" && !error.message.includes("sensitive"));
  assert.equal(state.otpHash, null); assert.equal(state.otpDeliveryState, null); assert.ok(state.otpResendAvailableAt > new Date());
});
test("provider response without acceptance receipt is a failure", async (t) => {
  t.mock.method(axios, "post", async () => ({ data: {} }));
  await assert.rejects(sendOtpEmail({ email: state.email, otp: "123456", purpose: "signup", deliveryId: "test" }), { code: "EMAIL_DELIVERY_FAILED" });
});
test("concurrent resend requests reserve only one code", async () => {
  const results = await Promise.allSettled([issueOtp(state, "signup"), issueOtp(state, "signup")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(sent.length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "OTP_COOLDOWN");
});
for (const scenario of ["expired", "pending-delivery", "wrong-purpose", "disabled", "attempt-limit"]) test(`OTP rejects ${scenario}`, async () => {
  prepare();
  if (scenario === "expired") state.otpExpiresAt = new Date(0);
  if (scenario === "pending-delivery") state.otpDeliveryState = "pending";
  if (scenario === "wrong-purpose") state.otpPurpose = "password-reset";
  if (scenario === "disabled") state.accountStatus = "disabled";
  if (scenario === "attempt-limit") state.otpAttempts = 5;
  await assert.rejects(consumeOtp({ user: { ...state }, otp: "123456", purpose: "signup", changes: { isVerified: true } })); assert.equal(state.isVerified, false);
});
test("invalid attempts increment atomically and cannot exceed limit under concurrency", async () => {
  prepare(); const stale = { ...state };
  await Promise.allSettled(Array.from({ length: 12 }, () => consumeOtp({ user: stale, otp: "654321", purpose: "signup", changes: {} })));
  assert.equal(state.otpAttempts, 5);
  await assert.rejects(consumeOtp({ user: stale, otp: "123456", purpose: "signup", changes: { isVerified: true } }), { code: "INVALID_OTP" });
});
test("valid code is consumed once even with simultaneous stale snapshots", async () => {
  const snapshot = prepare();
  const results = await Promise.allSettled([1, 2].map(() => consumeOtp({ user: snapshot, otp: "123456", purpose: "signup", changes: { isVerified: true } })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(state.otpHash, null); assert.equal(state.isVerified, true);
  await assert.rejects(consumeOtp({ user: { ...state }, otp: "123456", purpose: "signup", changes: {} }));
});
const authenticate = async (version) => {
  const token = jwt.sign({ userId: state._id, ...(version === undefined ? {} : { sessionVersion: version }), role: "admin" }, process.env.JWT_SECRET);
  let status, next = false, req = { headers: { authorization: `Bearer ${token}` } };
  await auth(req, { status(code) { status = code; return this; }, json() {} }, () => { next = true; });
  return { status, next, req };
};
test("password reset atomically revokes old and legacy JWTs, accepts new version", async () => {
  const snapshot = prepare("password-reset"); assert.equal((await authenticate()).next, true);
  await consumeOtp({ user: snapshot, otp: "123456", purpose: "password-reset", changes: { password: "new-test-hash" }, resetPassword: true });
  assert.equal(state.sessionVersion, 1); assert.equal(state.password, "new-test-hash"); assert.equal(state.otpHash, null);
  assert.equal((await authenticate()).status, 401); assert.equal((await authenticate(0)).status, 401); assert.equal((await authenticate(1)).next, true);
});
test("failed reset does not change password or session version", async () => {
  prepare("password-reset");
  await assert.rejects(consumeOtp({ user: { ...state }, otp: "999999", purpose: "password-reset", changes: { password: "new" }, resetPassword: true }));
  assert.equal(state.sessionVersion, 0); assert.equal(state.password, undefined);
});
test("optional password reset supports unverified email accounts without falsely verifying them", async () => {
  prepare("password-reset"); state.isVerified = false;
  await consumeOtp({ user: { ...state }, otp: "123456", purpose: "password-reset", changes: { password: "new-test-hash" }, resetPassword: true });
  assert.equal(state.isVerified, false); assert.equal(state.sessionVersion, 1);
});
test("session uses current database role and rejects disabled accounts", async () => {
  assert.equal((await authenticate(0)).req.user.role, "doctor"); state.accountStatus = "disabled"; assert.equal((await authenticate(0)).status, 403);
});
test("session endpoint refreshes approval and rejection without exposing secrets", async () => {
  state.isVerified = true; state.password = "private"; state.otpHash = "private";
  const app = express(); app.use(express.json()); app.use("/auth", router); app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const token = jwt.sign({ userId: state._id }, process.env.JWT_SECRET);
    for (const status of ["pending", "verified", "rejected"]) {
      state.doctorVerificationStatus = status; state.isDoctorVerified = true;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/session`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.user.doctorVerificationStatus, status);
      assert.equal(JSON.stringify(data).includes("private"), false); assert.equal(data.user.sessionVersion, undefined);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
const withAuthHttp = async (run) => {
  const app = express(); app.use(express.json()); app.use("/auth", router); app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const post = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try { await run(post); } finally { await new Promise(resolve => server.close(resolve)); }
};
test("HTTP resend then verification issues session without exposing OTP and blocks reuse", async () => withAuthHttp(async post => {
  const resend = await post("resend-otp", { email: state.email });
  assert.equal(resend.status, 200); assert.equal(resend.body.developmentOtp, undefined); assert.equal(resend.body.delivery, "provider-accepted");
  const otp = /code is (\d{6})/.exec(sent[0].body.text)[1];
  const verified = await post("verify-otp", { email: state.email, otp });
  assert.equal(verified.status, 200); assert.equal(verified.body.user.isVerified, true);
  assert.equal(jwt.verify(verified.body.token, process.env.JWT_SECRET).sessionVersion, 0);
  assert.equal((await post("verify-otp", { email: state.email, otp })).status, 400);
}));
test("HTTP delivery failure is 503 without OTP or provider error leakage", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(axios, "post", async () => { throw new Error("provider secret"); });
  await withAuthHttp(async post => { const result = await post("resend-otp", { email: state.email }); assert.equal(result.status, 503); assert.equal(result.body.code, "EMAIL_DELIVERY_FAILED"); assert.equal(JSON.stringify(result.body).includes("secret"), false); });
});
test("HTTP reset changes password and revokes session, never issues an automatic login", async () => withAuthHttp(async post => {
  prepare("password-reset");
  const result = await post("reset-password", { email: state.email, otp: "123456", password: "synthetic-new-password" });
  assert.equal(result.status, 200); assert.equal(result.body.token, undefined); assert.equal(state.sessionVersion, 1);
  assert.equal(await require("bcryptjs").compare("synthetic-new-password", state.password), true);
  assert.equal((await authenticate(0)).status, 401);
}));
test("signup retry cannot replace existing unverified password or role", async () => withAuthHttp(async post => {
  state.password = "original-hash"; state.role = "doctor";
  const result = await post("signup", { name: "Different", email: state.email, phone: "1234567890", password: "replacement-password", role: "patient" });
  assert.equal(result.status, 409); assert.equal(state.password, "original-hash"); assert.equal(state.role, "doctor"); assert.equal(state.name, "Fixture");
}));
test("doctor onboarding rejects incomplete professional details before delivery", async () => withAuthHttp(async post => {
  const result = await post("signup", { name: "Fixture", email: state.email, phone: "1234567890", password: "synthetic-password", role: "doctor", specialty: "ENT", qualifications: [], languages: [], bio: "", experienceYears: -1 });
  assert.equal(result.status, 400); assert.equal(sent.length, 0);
}));
test("failed atomic reset write cannot partially change password or revoke sessions", async (t) => {
  prepare("password-reset");
  t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("injected database failure"); });
  await assert.rejects(consumeOtp({ user: { ...state }, otp: "123456", purpose: "password-reset", changes: { password: "new" }, resetPassword: true }), /injected/);
  assert.equal(state.sessionVersion, 0); assert.equal(state.password, undefined); assert.ok(state.otpHash);
});

test("database lookup failure is forwarded rather than reported as invalid token", async (t) => {
  const failure = new Error("injected lookup outage");
  t.mock.method(User, "findById", () => ({ select: async () => { throw failure; } }));
  const token = jwt.sign({ userId: state._id }, process.env.JWT_SECRET);
  let forwarded;
  await auth({ headers: { authorization: `Bearer ${token}` } }, { status() { assert.fail("must not report 401"); } }, error => { forwarded = error; });
  assert.equal(forwarded, failure);
});
