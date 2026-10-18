"use strict";
// Invoked only by suite.cjs AFTER the unchanged disposable preflight/claim.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createStartAt, localDateKey } = require("../../services/appointmentDomain");
const fixture = async context => {
  const common = { name: "Scheduling fixture", phone: "9999999991", password: "synthetic-not-a-login-hash", accountStatus: "active", isVerified: false };
  const hours = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 30 }));
  const users = [];
  for (const role of ["doctor", "doctor", "patient", "patient"]) users.push(await context.models.User.create({ ...common, role, email: `${role}.${crypto.randomUUID()}@example.test`, ...(role === "doctor" ? { specialty: "ENT", doctorVerificationStatus: "verified", availability: hours } : {}) }));
  const [doctor, otherDoctor, patient, otherPatient] = users;
  const date = localDateKey(new Date(Date.now() + 7 * 86400000));
  const body = (time = "09:00", extra = {}) => ({ doctor: String(doctor._id), startAt: createStartAt(date, time).toISOString(), problem: "Synthetic scheduling concern", durationMinutes: 30, ...extra });
  const book = (person = patient, values = body()) => context.scheduling.book({ patientId: String(person._id), body: values });
  return { doctor, otherDoctor, patient, otherPatient, body, book };
};
const oneWinner = results => { assert.equal(results.filter(item => item.status === "fulfilled").length, 1); assert.equal(results.find(item => item.status === "rejected").reason.status, 409); };
async function runSchedulingScenarios({ replica, single, check, rs, failCommits }) {
  await check("real scheduling same-doctor contention permits only one booking", async () => {
    const f = await fixture(replica); oneWinner(await Promise.allSettled([f.book(), f.book(f.otherPatient)]));
    assert.equal(await replica.models.Appointment.countDocuments({ doctor: f.doctor._id }), 1);
  });
  await check("real different-start patient overlap across doctors is rejected concurrently", async () => {
    const f = await fixture(replica);
    await replica.scheduling.availability({ doctorId: String(f.otherDoctor._id), body: { availability: f.otherDoctor.availability.map(day => ({ weekday: day.weekday, startTime: "09:15", endTime: "17:15", appointmentDurationMinutes: 30 })), unavailableDates: [] } });
    oneWinner(await Promise.allSettled([f.book(), f.book(f.patient, f.body("09:15", { doctor: String(f.otherDoctor._id) }))]));
    assert.equal(await replica.models.Appointment.countDocuments({ patient: f.patient._id }), 1);
  });
  await check("real doctor overlap with an earlier duration survives availability change", async () => {
    const f = await fixture(replica);
    const hours = f.doctor.availability.map(day => ({ weekday: day.weekday, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 60 }));
    await replica.scheduling.availability({ doctorId: String(f.doctor._id), body: { availability: hours, unavailableDates: [] } });
    await f.book(f.patient, f.body("09:00", { durationMinutes: 60 }));
    await replica.scheduling.availability({ doctorId: String(f.doctor._id), body: { availability: hours.map(day => ({ ...day, appointmentDurationMinutes: 30 })), unavailableDates: [], confirmConflicts: true } });
    await assert.rejects(f.book(f.otherPatient, f.body("09:30")), { status: 409 });
  });
  await check("real duplicate scheduling requests create one appointment and event set", async () => {
    const f = await fixture(replica); const values = f.body("09:00", { requestId: crypto.randomUUID() });
    const results = await Promise.all(Array.from({ length: 4 }, () => f.book(f.patient, values)));
    assert.equal(new Set(results.map(result => String(result.appointment._id))).size, 1);
    assert.equal(await replica.models.Notification.countDocuments({ recipient: f.patient._id }), 1);
    assert.equal(await replica.models.AuditLog.countDocuments({ actor: f.patient._id }), 1);
    await assert.rejects(f.book(f.patient, { ...values, problem: "Conflicting retry" }), { status: 409 });
  });
  await check("real concurrent reschedules cannot occupy the same interval", async () => {
    const f = await fixture(replica); const first = await f.book(); const second = await f.book(f.otherPatient, f.body("10:00"));
    oneWinner(await Promise.allSettled([[first, f.patient], [second, f.otherPatient]].map(([result, person]) => replica.scheduling.reschedule({ appointmentId: String(result.appointment._id), patientId: String(person._id), body: { ...f.body("11:00"), appointmentVersion: 0 } }))));
  });
  await check("real cancellation versus reschedule uses appointment version", async () => {
    const f = await fixture(replica); const result = await f.book(); const appointmentId = String(result.appointment._id);
    oneWinner(await Promise.allSettled([replica.scheduling.cancel({ appointmentId, actorId: String(f.patient._id), actorRole: "patient", appointmentVersion: 0 }), replica.scheduling.reschedule({ appointmentId, patientId: String(f.patient._id), body: { ...f.body("10:00"), appointmentVersion: 0 } })]));
  });
  await check("real cancellation versus completion has one winner", async () => {
    const f = await fixture(replica); const result = await f.book(); const appointmentId = String(result.appointment._id);
    oneWinner(await Promise.allSettled([replica.scheduling.cancel({ appointmentId, actorId: String(f.patient._id), actorRole: "patient", appointmentVersion: 0 }), replica.complete({ appointmentId, doctorId: String(f.doctor._id), body: { appointmentVersion: 0, consultation: { chiefComplaint: "Concern", diagnosis: "Assessment", advice: "Advice" } } })]));
    const appointment = await replica.models.Appointment.findById(appointmentId);
    assert.equal(await replica.models.Consultation.countDocuments({ appointment: appointmentId }), appointment.status === "completed" ? 1 : 0);
  });
  await check("real booking notification failure rolls back reservation and audit", async () => {
    const f = await fixture(replica); const before = await replica.models.User.findById(f.doctor._id).select("+schedulingVersion").lean();
    const collection = replica.models.Notification.collection.collectionName;
    await rs.connection.db.command({ collMod: collection, validator: { recipient: { $ne: f.patient._id } }, validationLevel: "strict", validationAction: "error" });
    try { await assert.rejects(f.book(), error => error.code === 121); }
    finally { await rs.connection.db.command({ collMod: collection, validator: {}, validationLevel: "strict" }); }
    assert.equal(await replica.models.Appointment.countDocuments({ doctor: f.doctor._id }), 0);
    assert.equal(await replica.models.AuditLog.countDocuments({ actor: f.patient._id }), 0);
    assert.equal((await replica.models.User.findById(f.doctor._id).select("+schedulingVersion")).schedulingVersion, before.schedulingVersion);
  });
  await check("real availability change versus booking cannot miss a new reservation", async () => {
    const f = await fixture(replica); const results = await Promise.allSettled([f.book(), replica.scheduling.availability({ doctorId: String(f.doctor._id), body: { availability: [], unavailableDates: [] } })]);
    assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  });
  await check("real draft save guards appointment state and preserves notes on stale requests", async () => {
    const f = await fixture(replica); const result = await f.book(); const appointmentId = String(result.appointment._id);
    const saved = await replica.scheduling.saveDraft({ appointmentId, doctorId: String(f.doctor._id), body: { appointmentVersion: 0, chiefComplaint: "Original fixture notes" } });
    assert.equal(saved.appointmentVersion, 1);
    await assert.rejects(replica.scheduling.saveDraft({ appointmentId, doctorId: String(f.doctor._id), body: { appointmentVersion: 0, chiefComplaint: "Stale" } }), { status: 409 });
    await assert.rejects(replica.scheduling.reschedule({ appointmentId, patientId: String(f.patient._id), body: { ...f.body("10:00"), appointmentVersion: 1 } }), { status: 409 });
    assert.equal((await replica.models.Consultation.findOne({ appointment: appointmentId })).chiefComplaint, "Original fixture notes");
  });
  await check("real booking commit acknowledgement uncertainty replays without duplicates", async () => {
    const f = await fixture(replica); const values = f.body("09:00", { requestId: crypto.randomUUID() });
    await failCommits("alwaysOn", async () => {
      await assert.rejects(f.book(f.patient, values), { status: 503, code: "SCHEDULING_OUTCOME_UNKNOWN" });
    });
    await f.book(f.patient, values);
    assert.equal(await replica.models.Appointment.countDocuments({ patient: f.patient._id }), 1);
    assert.equal(await replica.models.Notification.countDocuments({ recipient: f.patient._id }), 1);
  });
  await check("standalone booking fails closed without creating reservations", async () => {
    const f = await fixture(single);
    await assert.rejects(f.book(), { status: 503, code: "TRANSACTIONS_REQUIRED" });
    assert.equal(await single.models.Appointment.countDocuments({ doctor: f.doctor._id }), 0);
  });
}
module.exports = { runSchedulingScenarios };
