const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const testUri = String(process.env.MONGO_URI_TEST || "").trim();
const developmentUri = String(process.env.MONGO_URI || "").trim();
const safeTestUri = testUri && testUri !== developmentUri && /test/i.test(testUri);

if (!safeTestUri) {
  test("HTTP + MongoDB integration suite requires a distinct MONGO_URI_TEST containing 'test'", { skip: true }, () => {});
} else {
  process.env.MONGO_URI = testUri;
  process.env.JWT_SECRET ||= "integration-test-secret-that-is-never-used-outside-tests";
  process.env.GEMINI_API_KEY ||= "not-called-in-deterministic-tests";
  process.env.NODE_ENV = "test";
  process.env.DEV_SHOW_OTP = "true";
  const mongoose = require("mongoose");
  const { app } = require("../server");
  let server;
  let baseUrl;
  let patientToken;

  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
    return { status: response.status, body: await response.json() };
  };

  before(async () => {
    await mongoose.connect(testUri);
    await mongoose.connection.db.dropDatabase();
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  test("auth lifecycle persists a patient and protects authenticated APIs", async () => {
    const signup = await request("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Integration Patient", email: "patient.integration@example.test", phone: "9999999991", password: "IntegrationOnly123!" }) });
    assert.equal(signup.status, 200);
    assert.match(signup.body.developmentOtp, /^\d{6}$/);
    const verified = await request("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ email: "patient.integration@example.test", otp: signup.body.developmentOtp }) });
    assert.equal(verified.status, 200);
    patientToken = verified.body.token;
    const profile = await request("/api/auth/profile", { headers: { authorization: `Bearer ${patientToken}` } });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.email, "patient.integration@example.test");
  });

  test("protected APIs reject missing credentials with structured errors", async () => {
    const response = await request("/api/appointments/my");
    assert.equal(response.status, 401);
    assert.equal(typeof response.body.message, "string");
  });

  test("patient persisted endpoints return isolated empty-state data", async () => {
    const headers = { authorization: `Bearer ${patientToken}` };
    for (const path of ["/api/appointments/my", "/api/medical-records/my", "/api/patient/prescriptions", "/api/patient/consultations", "/api/notifications"]) {
      const response = await request(path, { headers });
      assert.equal(response.status, 200, path);
    }
  });

  test("unknown APIs use the global structured 404 shape", async () => {
    const response = await request("/api/does-not-exist");
    assert.deepEqual(response.body, { message: "API route not found", code: "ROUTE_NOT_FOUND" });
    assert.equal(response.status, 404);
  });
}
