const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const axios = require("axios");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const { findDoctors, approvedDoctorFilter, NO_MATCH_MESSAGE } = require("../services/doctorRecommendations");
const { SPECIALTIES, normalizeSpecialty } = require("../services/specialties");
const { createTriageService, parseTriage, EMERGENCY_GUIDANCE } = require("../services/triageService");
const { createStartAt, localDateKey } = require("../services/appointmentDomain");
const { slotsForDate } = require("../services/appointmentSlots");
const { AppError, errorHandler } = require("../middleware/errorHandler");

const now = new Date("2030-01-01T02:30:00Z"); // 08:00 clinic time
const patientId = String(new mongoose.Types.ObjectId());
const doctor = (specialty, name = specialty) => ({
  _id: new mongoose.Types.ObjectId(), name: `Fixture ${name}`, email: `${name.replace(/\W/g, "")}@example.test`,
  role: "doctor", specialty, isVerified: true, accountStatus: "active", doctorVerificationStatus: "verified", isDoctorVerified: true,
  qualifications: ["Fixture qualification"], experienceYears: 5, consultationFee: 700, languages: ["English"], bio: "Fixture profile",
  availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "10:00", appointmentDurationMinutes: 30 })), unavailableDates: [],
});
const json = (specialties, priority = "NORMAL") => JSON.stringify({ priority, specialties, summary: "Synthetic routing fixture, not a diagnosis.", recommendation: "Consult a qualified clinician for assessment." });
let doctors; let busy; let userQueries; let appointmentQueries;
let originalKey; let originalModel; let originalOffset;
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  originalKey = process.env.GEMINI_API_KEY; originalModel = process.env.GEMINI_MODEL; originalOffset = process.env.CLINIC_TIMEZONE_OFFSET;
  process.env.GEMINI_API_KEY = "synthetic-unit-test-value-not-a-real-key";
  delete process.env.GEMINI_MODEL;
  process.env.CLINIC_TIMEZONE_OFFSET = "+05:30";
  doctors = SPECIALTIES.map((specialty) => doctor(specialty)); busy = []; userQueries = []; appointmentQueries = [];
  t.mock.method(User, "find", (query) => { userQueries.push(query); return { select() { return this; }, lean: async () => doctors }; });
  t.mock.method(Appointment, "find", (query) => { appointmentQueries.push(query); return { select() { return this; }, lean: async () => busy }; });
  // A missed provider mock must fail immediately, never contact Gemini.
  t.mock.method(axios, "post", async () => { throw new Error("No real provider calls allowed"); });
});
afterEach(() => {
  for (const [key, value] of [["GEMINI_API_KEY", originalKey], ["GEMINI_MODEL", originalModel], ["CLINIC_TIMEZONE_OFFSET", originalOffset]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

// These are deterministic provider fixtures for routing, not tests of medical
// diagnosis or evidence that the live Gemini model classifies symptoms safely.
for (const [symptoms, specialty] of [
  ["Recurring migraine-like headaches without acute warning signs", "Neurologist"],
  ["Persistent itchy skin rash", "Dermatologist"],
  ["Knee discomfort after a minor injury", "Orthopedic"],
  ["Tooth pain needing dental assessment", "Dentist"],
  ["Eye irritation needing an eye assessment", "Ophthalmologist"],
  ["Ongoing mild stomach discomfort", "Gastroenterologist"],
  ["Routine fever without severe symptoms", "General Physician"],
]) {
  test(`mocked triage routes '${symptoms}' to ${specialty} records only`, async () => {
    let prompts = 0;
    const triage = createTriageService({ generateContent: async (options) => {
      prompts += 1; assert.equal(options.prompt, symptoms);
      assert.ok(options.responseJsonSchema.properties.specialties.items.enum.includes(specialty));
      assert.match(options.systemInstruction, /never use it as a universal fallback/);
      return json([specialty]);
    } });
    const result = await triage({ problem: symptoms, patientId });
    assert.equal(prompts, 1); assert.deepEqual(result.specialties, [specialty]);
    assert.equal(result.doctors.length, 1); assert.equal(result.doctors[0].specialty, specialty);
    assert.deepEqual(userQueries[0].specialty, { $in: [specialty] });
    assert.equal(result.doctors[0].consultationFee, 700);
    assert.match(result.doctors[0].recommendationReason, new RegExp(specialty));
  });
}

test("different concerns do not reuse the previous result or first database doctor", async () => {
  const replies = [json(["Dermatologist"]), json(["Dentist"])];
  const triage = createTriageService({ generateContent: async () => replies.shift() });
  const first = await triage({ problem: "Synthetic rash concern", patientId });
  const second = await triage({ problem: "Synthetic dental concern", patientId });
  assert.notEqual(String(first.doctors[0]._id), String(second.doctors[0]._id));
  assert.equal(second.doctors[0].specialty, "Dentist");
});

test("unknown specialty never becomes General Physician", () => {
  assert.equal(normalizeSpecialty("Unknown Specialty"), null);
  assert.equal(normalizeSpecialty(undefined), null);
  assert.equal(normalizeSpecialty("ophthalmology"), "Ophthalmologist");
  assert.equal(normalizeSpecialty("dentistry"), "Dentist");
});

for (const raw of ["bad JSON", "null", "[]", json(["Unknown Specialty"]), json([]), json(["Dermatologist"], "INVALID"),
  JSON.stringify({ priority: "NORMAL", specialties: ["Dermatologist"], summary: "", recommendation: "See a clinician" }),
  JSON.stringify({ ...JSON.parse(json(["Dermatologist"])), doctors: [{ name: "Invented" }] }),
  json(["Dermatologist", "Dermatologist"])]) {
  test(`invalid structured triage ${raw.slice(0, 30)} is rejected before doctor lookup`, async () => {
    const triage = createTriageService({ generateContent: async () => raw });
    await assert.rejects(triage({ problem: "Synthetic concern", patientId }), { status: 503, code: "AI_INVALID_RESPONSE" });
    assert.equal(userQueries.length, 0);
  });
}

test("emergency chest-pain fixture yields emergency guidance and no doctor query", async () => {
  const triage = createTriageService({ generateContent: async () => json(["Cardiologist"], "EMERGENCY") });
  const result = await triage({ problem: "Synthetic potentially serious chest pain", patientId });
  assert.equal(result.priority, "EMERGENCY"); assert.deepEqual(result.specialties, []); assert.deepEqual(result.doctors, []);
  assert.equal(result.recommendation, EMERGENCY_GUIDANCE); assert.equal(userQueries.length, 0);
});

test("unapproved, rejected, disabled and demo doctors are excluded", async () => {
  const approved = doctor("Dermatologist", "Approved");
  doctors = [approved, ...[
    { doctorVerificationStatus: "pending" }, { doctorVerificationStatus: "rejected" }, { accountStatus: "disabled" },
    { isDemo: true }, { email: "demo.dermatologist@mediflow.local" }, { bio: "Development-only sample profile" },
    { role: "patient" },
  ].map((override) => ({ ...doctor("Dermatologist"), ...override }))];
  const result = await findDoctors({ specialties: ["Dermatologist"], patientId });
  assert.deepEqual(result.map((item) => String(item._id)), [String(approved._id)]);
  assert.deepEqual(userQueries[0], { ...approvedDoctorFilter(), specialty: { $in: ["Dermatologist"] } });
});

test("missing specialist and empty database return an honest empty result", async () => {
  const triage = createTriageService({ generateContent: async () => json(["Dermatologist"]) });
  doctors = [doctor("General Physician")];
  const result = await triage({ problem: "Synthetic rash concern", patientId });
  assert.deepEqual(result.doctors, []); assert.equal(result.message, NO_MATCH_MESSAGE);
  doctors = [];
  assert.deepEqual((await triage({ problem: "Synthetic rash concern", patientId })).doctors, []);
});
test("approved doctor with unverified email remains discoverable without approval bypass", async () => {
  doctors = [{ ...doctor("ENT"), isVerified: false }];
  assert.equal((await findDoctors({ specialties: ["ENT"], patientId })).length, 1);
  assert.equal(userQueries[0].isVerified, undefined);
});

test("one matching doctor is reported as an inventory limitation", async () => {
  doctors = [doctor("General Physician")];
  const triage = createTriageService({ generateContent: async () => json(["General Physician"]) });
  const result = await triage({ problem: "Synthetic routine fever", patientId });
  assert.equal(result.doctors.length, 1); assert.match(result.message, /Only one matching verified doctor/);
});

test("multiple matches rank by specialty relevance then actual next slot with stable ties", async () => {
  const first = doctor("Dermatologist", "A"); const second = doctor("Dermatologist", "B"); const third = doctor("General Physician");
  doctors = [first, second, third];
  busy = [{ doctor: first._id, patient: new mongoose.Types.ObjectId(), startAt: createStartAt("2030-01-01", "09:00"), durationMinutes: 30 }];
  const options = { specialties: ["Dermatologist", "General Physician"], patientId };
  const result = await findDoctors(options);
  assert.deepEqual(result.map((item) => String(item._id)), [second, first, third].map((item) => String(item._id)));
  doctors.reverse();
  assert.deepEqual((await findDoctors(options)).map((item) => String(item._id)), result.map((item) => String(item._id)));
  assert.equal(appointmentQueries[0].status, "scheduled");
  assert.equal(appointmentQueries[0].$or[1].patient, patientId);
});

test("patient conflicts, blocked dates and absent availability affect real next-slot eligibility", async () => {
  const available = doctor("Dermatologist", "Available"); const noHours = { ...doctor("Dermatologist"), availability: [] };
  const blocked = doctor("Dermatologist", "Blocked");
  blocked.unavailableDates = Array.from({ length: 14 }, (_, day) => localDateKey(new Date(now.getTime() + day * 86400000)));
  doctors = [available, noHours, blocked];
  busy = [{ doctor: new mongoose.Types.ObjectId(), patient: patientId, startAt: createStartAt("2030-01-01", "09:00"), durationMinutes: 30 }];
  const result = await findDoctors({ specialties: ["Dermatologist"], patientId });
  assert.equal(result.length, 1); assert.equal(result[0].nextAvailableAt, createStartAt("2030-01-01", "09:30").toISOString());
  assert.deepEqual(slotsForDate(available, "2030-02-30", [], now), []);
});

test("Gemini failure never queries doctors or fabricates a fallback", async () => {
  const triage = createTriageService({ generateContent: async () => { throw new AppError(503, "AI unavailable", "AI_UNAVAILABLE"); } });
  await assert.rejects(triage({ problem: "Synthetic concern", patientId }), { code: "AI_UNAVAILABLE" });
  assert.equal(userQueries.length, 0);
});

test("provider call sends exact concern, system instructions and schema with backend-only key", async (t) => {
  t.mock.method(axios, "post", async (url, data, options) => {
    assert.equal(url.includes("?key="), false);
    assert.equal(options.headers["x-goog-api-key"], process.env.GEMINI_API_KEY);
    assert.equal(data.contents[0].parts[0].text, "Synthetic skin rash");
    assert.ok(data.systemInstruction.parts[0].text);
    assert.equal(data.generationConfig.responseJsonSchema.additionalProperties, false);
    return { data: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: json(["Dermatologist"]) }] } }] } };
  });
  const result = await createTriageService()({ problem: "Synthetic skin rash", patientId });
  assert.equal(result.doctors[0].specialty, "Dermatologist");
});

test("truncated or empty provider responses fail without recommendations", async (t) => {
  t.mock.method(axios, "post", async () => ({ data: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: json(["Dermatologist"]) }] } }] } }));
  await assert.rejects(createTriageService()({ problem: "Synthetic concern", patientId }), { code: "AI_UNAVAILABLE" });
  assert.equal(userQueries.length, 0);
});

test("controlled AI outage is readable while unknown internal errors remain redacted", (t) => {
  t.mock.method(console, "error", () => {});
  const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  errorHandler(new AppError(503, "AI guidance is unavailable. Select a specialty manually.", "AI_UNAVAILABLE"), {}, res, () => {});
  assert.equal(res.statusCode, 503); assert.match(res.body.message, /Select a specialty manually/);
  errorHandler(new Error("Sensitive internal diagnostic"), {}, res, () => {});
  assert.equal(res.statusCode, 500); assert.equal(res.body.message, "Internal server error");
});

test("booking-compatible symptom limit is enforced before provider lookup", async () => {
  await assert.rejects(createTriageService()({ problem: "x".repeat(2001), patientId }), { status: 400 });
  assert.equal(userQueries.length, 0);
  assert.equal(parseTriage(json(["General Physician"])).priority, "NORMAL");
});
