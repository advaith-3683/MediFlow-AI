const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { createStartAt, availabilityForStart, overlaps, assertOwnership, validateAppointmentSlot } = require("../services/appointmentDomain");

process.env.CLINIC_TIMEZONE_OFFSET = "+05:30";
const doctorId = new mongoose.Types.ObjectId();
const patientId = new mongoose.Types.ObjectId();
const doctor = { _id: doctorId, unavailableDates: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 30 })) };
const futureDate = () => { const date = new Date(Date.now() + 7 * 24 * 60 * 60_000); return date.toISOString().slice(0, 10); };

test("properly detects interval overlap", () => {
  const start = new Date("2030-01-01T10:00:00Z");
  assert.equal(overlaps(start, 30, new Date("2030-01-01T10:15:00Z"), 30), true);
  assert.equal(overlaps(start, 30, new Date("2030-01-01T10:30:00Z"), 30), false);
});

test("patient and doctor ownership checks reject another user's appointment", () => {
  const appointment = { patient: new mongoose.Types.ObjectId(), doctor: doctorId };
  assert.throws(() => assertOwnership(appointment, "patient", patientId), /not found/);
  assert.throws(() => assertOwnership(appointment, "doctor", new mongoose.Types.ObjectId()), /not found/);
  assert.doesNotThrow(() => assertOwnership(appointment, "doctor", doctorId));
});

test("booking outside availability and past booking are rejected", async () => {
  const outside = createStartAt(futureDate(), "18:00");
  assert.equal(availabilityForStart(doctor, outside, 30), null);
  await assert.rejects(validateAppointmentSlot({ doctor, patientId, startAt: outside, durationMinutes: 30 }), /outside/);
  await assert.rejects(validateAppointmentSlot({ doctor, patientId, startAt: new Date(Date.now() - 60_000), durationMinutes: 30 }), /future/);
});

test("valid booking succeeds when neither doctor nor patient collides", async () => {
  const original = Appointment.exists; Appointment.exists = async () => null;
  try { await assert.doesNotReject(validateAppointmentSlot({ doctor, patientId, startAt: createStartAt(futureDate(), "10:00"), durationMinutes: 30 })); }
  finally { Appointment.exists = original; }
});

test("duplicate doctor slot and overlapping patient appointment are rejected", async () => {
  const original = Appointment.exists;
  try {
    let calls = 0; Appointment.exists = async () => (++calls === 1 ? { _id: "collision" } : null);
    await assert.rejects(validateAppointmentSlot({ doctor, patientId, startAt: createStartAt(futureDate(), "10:00"), durationMinutes: 30 }), /doctor is already booked/);
    calls = 0; Appointment.exists = async () => (++calls === 2 ? { _id: "collision" } : null);
    await assert.rejects(validateAppointmentSlot({ doctor, patientId, startAt: createStartAt(futureDate(), "10:00"), durationMinutes: 30 }), /overlapping appointment/);
  } finally { Appointment.exists = original; }
});

test("reschedule validation excludes the current appointment but still checks collisions", async () => {
  const original = Appointment.exists; const queries = []; Appointment.exists = async (query) => { queries.push(query); return null; };
  try {
    const excluded = new mongoose.Types.ObjectId();
    await validateAppointmentSlot({ doctor, patientId, startAt: createStartAt(futureDate(), "11:00"), durationMinutes: 30, excludeAppointmentId: excluded });
    assert.equal(String(queries[0]._id.$ne), String(excluded));
  } finally { Appointment.exists = original; }
});
