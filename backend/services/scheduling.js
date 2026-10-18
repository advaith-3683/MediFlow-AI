const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { AppError } = require("../middleware/errorHandler");
const { approvedDoctorFilter } = require("./doctorRecommendations");
const { canonicalStartAt, localDateKey, availabilityForStart, legacyStartAt, overlaps } = require("./appointmentDomain");
const { validateAvailability, sanitizeConsultation } = require("./clinicalDomain");
const fail = (status, message, code = "SCHEDULING_CONFLICT") => { throw new AppError(status, message, code); };
const version = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail(400, "An appointment version is required. Reload before retrying", "APPOINTMENT_VERSION_REQUIRED");
  return value;
};
const versionFilter = (appointment, expected) => ({ _id: appointment._id, status: "scheduled",
  ...(expected === 0 ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] } : { __v: expected }) });
const transaction = async (db, operation) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let session;
    try {
      session = await db.mongoose.startSession();
      return await session.withTransaction(() => operation(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    } catch (error) {
      if (error.code === 11000 && attempt === 0) continue;
      if (error.code === 11000 || error.name === "VersionError") fail(409, "Record changed or slot reserved. Reload before retrying");
      if ([20, 303].includes(error.code)) fail(503, "Scheduling requires MongoDB transaction support", "TRANSACTIONS_REQUIRED");
      if (error.hasErrorLabel?.("UnknownTransactionCommitResult")) fail(503, "Outcome uncertain. Reload the record, or retry the identical booking request", "SCHEDULING_OUTCOME_UNKNOWN");
      throw error;
    } finally { if (session) await session.endSession(); }
  }
};
const createSchedulingService = (dependencies = {}) => {
  const db = { mongoose, User, Appointment, Consultation, Prescription, AuditLog, Notification, ...dependencies };
  // These are real writes, not reads or advisory application locks. Transactions
  // sharing either account conflict and the driver retries with a fresh snapshot.
  const lockDoctor = async (id, session) => {
    const doctor = await db.User.findOneAndUpdate({ _id: id, ...approvedDoctorFilter() }, { $inc: { schedulingVersion: 1 } }, { session, new: true });
    if (!doctor) fail(404, "Verified doctor not found");
    return doctor;
  };
  const lockPatient = async (id, session) => {
    if (!await db.User.findOneAndUpdate({ _id: id, role: "patient", accountStatus: { $ne: "disabled" } }, { $inc: { schedulingVersion: 1 } }, { session, new: true })) fail(403, "Active patient account required");
  };
  const checkSlot = async (doctor, patientId, startAt, duration, session, exclude) => {
    if (startAt <= new Date()) fail(400, "Appointments must be booked in the future");
    if (!Number.isInteger(duration) || duration < 10 || duration > 240 || !availabilityForStart(doctor, startAt, duration)) fail(400, "The selected time is outside this doctor's availability");
    const filter = { status: "scheduled", $or: [{ doctor: doctor._id }, { patient: patientId }], ...(exclude ? { _id: { $ne: exclude } } : {}) };
    const busy = await db.Appointment.find(filter).select("startAt durationMinutes appointmentDate appointmentTime").session(session);
    for (const item of busy) {
      const raw = legacyStartAt(item); const time = raw ? new Date(raw) : null;
      if (!time || Number.isNaN(time.getTime())) fail(409, "An existing scheduled appointment requires date review", "LEGACY_SCHEDULE_REVIEW_REQUIRED");
      if (overlaps(startAt, duration, time, item.durationMinutes || 30)) fail(409, "Doctor or patient already has an overlapping appointment");
    }
  };
  const audit = async (actorId, actorRole, action, appointment, session, metadata = {}) => {
    await new db.AuditLog({ actor: actorId, actorRole, action, targetType: "Appointment", targetId: appointment._id, patient: appointment.patient, metadata }).save({ session });
  };
  const notifications = async (appointment, type, message, session) => {
    for (const [recipient, link] of [[appointment.patient, "/patient/appointments"], [appointment.doctor, "/doctor/appointments"]]) {
      const notificationType = type === "APPOINTMENT_BOOKED" && link === "/doctor/appointments" ? "NEW_APPOINTMENT" : type;
      const title = type === "APPOINTMENT_BOOKED" ? "Appointment booked" : type === "APPOINTMENT_RESCHEDULED" ? "Appointment rescheduled" : "Appointment cancelled";
      await new db.Notification({ recipient, type: notificationType, title, message, link }).save({ session });
    }
  };
  const publicAppointment = async (appointment, session) => {
    await appointment.populate([{ path: "doctor", select: "name email specialty", ordered: true, options: { session } }]);
    const value = appointment.toObject(); delete value.bookingRequestHash; return value;
  };
  const book = async ({ patientId, body }) => {
    if (body.priority === "emergency") fail(409, "Seek immediate emergency care rather than routine booking", "EMERGENCY_CARE_REQUIRED");
    if (!mongoose.isValidObjectId(body.doctor) || typeof body.problem !== "string" || !body.problem.trim() || body.problem.trim().length > 2000) fail(400, "Valid doctor and problem are required");
    const startAt = canonicalStartAt(body.startAt);
    const values = { doctor: body.doctor, patient: patientId, problem: body.problem.trim(), startAt, durationMinutes: Number(body.durationMinutes),
      priority: body.priority === "urgent" ? "urgent" : "normal", aiSummary: String(body.aiSummary || "").slice(0, 4000) };
    const hash = crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.requestId))) fail(400, "Invalid booking request ID");
    // Built-in unique _id supplies durable idempotency without a new index.
    const id = crypto.createHash("sha256").update(`${patientId}:${body.requestId || hash}`).digest("hex").slice(0, 24);
    return transaction(db, async session => {
      const existing = await db.Appointment.findById(id).select("+bookingRequestHash").session(session);
      if (existing) {
        if (String(existing.patient) !== String(patientId) || existing.bookingRequestHash !== hash) fail(409, "Booking request ID was already used for different data");
        return { appointment: await publicAppointment(existing, session), replayed: true };
      }
      const doctor = await lockDoctor(body.doctor, session);
      await lockPatient(patientId, session);
      await checkSlot(doctor, patientId, startAt, values.durationMinutes, session);
      const appointment = new db.Appointment({ _id: id, ...values, specialty: doctor.specialty, appointmentDate: localDateKey(startAt), bookingRequestHash: hash });
      await appointment.save({ session });
      await audit(patientId, "patient", "APPOINTMENT_BOOKED", appointment, session);
      await notifications(appointment, "APPOINTMENT_BOOKED", "An appointment was booked.", session);
      return { appointment: await publicAppointment(appointment, session), replayed: false };
    });
  };
  const reschedule = async ({ appointmentId, patientId, body }) => {
    const expected = version(body.appointmentVersion); const startAt = canonicalStartAt(body.startAt);
    return transaction(db, async session => {
      const appointment = await db.Appointment.findOne({ _id: appointmentId, patient: patientId }).session(session);
      if (!appointment) fail(404, "Appointment not found");
      if (appointment.status !== "scheduled" || !legacyStartAt(appointment) || new Date(legacyStartAt(appointment)) <= new Date()) fail(409, "Only future scheduled appointments can be rescheduled");
      const duration = Number(body.durationMinutes ?? appointment.durationMinutes);
      // Identical reschedule retry is a no-op, including notification/audit writes.
      if ((appointment.__v || 0) === expected + 1 && +appointment.startAt === +startAt && appointment.durationMinutes === duration) return publicAppointment(appointment, session);
      if ((appointment.__v || 0) !== expected) fail(409, "Appointment changed. Reload before rescheduling");
      const doctor = await lockDoctor(appointment.doctor, session); await lockPatient(patientId, session);
      if (await db.Consultation.findOne({ appointment: appointment._id }).session(session)) fail(409, "An appointment with clinical notes cannot be rescheduled");
      await checkSlot(doctor, patientId, startAt, duration, session, appointment._id);
      const updated = await db.Appointment.findOneAndUpdate(versionFilter(appointment, expected), { $set: { startAt, durationMinutes: duration, appointmentDate: localDateKey(startAt), appointmentTime: "" }, $inc: { __v: 1 } }, { session, new: true, runValidators: true });
      if (!updated) fail(409, "Appointment changed. Reload before rescheduling");
      await audit(patientId, "patient", "APPOINTMENT_RESCHEDULED", updated, session);
      await notifications(updated, "APPOINTMENT_RESCHEDULED", "An appointment was rescheduled.", session);
      return publicAppointment(updated, session);
    });
  };
  const cancel = async ({ appointmentId, actorId, actorRole, appointmentVersion, reason = "" }) => {
    const expected = version(appointmentVersion);
    return transaction(db, async session => {
      const owner = actorRole === "patient" ? { patient: actorId } : actorRole === "doctor" ? { doctor: actorId } : actorRole === "admin" ? {} : fail(403, "Unauthorized cancellation");
      const appointment = await db.Appointment.findOne({ _id: appointmentId, ...owner }).session(session);
      if (!appointment) fail(404, "Appointment not found");
      if (actorRole === "doctor") await lockDoctor(actorId, session);
      if (appointment.status === "cancelled" && (appointment.__v || 0) === expected + 1) return appointment.toObject();
      if (appointment.status !== "scheduled" || (appointment.__v || 0) !== expected) fail(409, "Only unchanged scheduled appointments can be cancelled");
      if (actorRole === "patient" && (!legacyStartAt(appointment) || new Date(legacyStartAt(appointment)) <= new Date())) fail(409, "Only future appointments can be cancelled");
      const updated = await db.Appointment.findOneAndUpdate(versionFilter(appointment, expected), { $set: { status: "cancelled" }, $inc: { __v: 1 } }, { session, new: true, runValidators: true });
      if (!updated) fail(409, "Appointment changed during cancellation");
      await audit(actorId, actorRole, actorRole === "admin" ? "ADMIN_APPOINTMENT_CANCELLED" : "APPOINTMENT_CANCELLED", updated, session, reason ? { reason } : {});
      await notifications(updated, "APPOINTMENT_CANCELLED", "An appointment was cancelled.", session);
      return updated.toObject();
    });
  };
  const availability = async ({ doctorId, body }) => {
    const proposed = validateAvailability(body.availability, body.unavailableDates);
    return transaction(db, async session => {
      const doctor = await lockDoctor(doctorId, session);
      const future = await db.Appointment.find({ doctor: doctorId, status: "scheduled" }).session(session);
      const conflicts = future.filter(item => { const time = legacyStartAt(item); return !time || (new Date(time) > new Date() && !availabilityForStart(proposed, new Date(time), item.durationMinutes)); });
      if (conflicts.length && body.confirmConflicts !== true) {
        const error = new AppError(409, "This schedule conflicts with existing appointments. No appointments were changed", "AVAILABILITY_CONFLICT");
        error.conflictCount = conflicts.length; throw error;
      }
      doctor.availability = proposed.availability; doctor.unavailableDates = proposed.unavailableDates; await doctor.save({ session });
      await new db.AuditLog({ actor: doctorId, actorRole: "doctor", action: "DOCTOR_AVAILABILITY_UPDATED", targetType: "User", targetId: doctorId, metadata: { conflictCount: conflicts.length } }).save({ session });
      return { message: "Availability updated. Existing appointments were not changed", ...proposed, conflictCount: conflicts.length };
    });
  };
  const saveDraft = async ({ appointmentId, doctorId, body }) => {
    const expected = version(body.appointmentVersion);
    return transaction(db, async session => {
      await lockDoctor(doctorId, session);
      const appointment = await db.Appointment.findOne({ _id: appointmentId, doctor: doctorId }).session(session);
      if (!appointment) fail(404, "Appointment not found");
      if ((appointment.__v || 0) !== expected || appointment.status !== "scheduled") fail(409, "Appointment changed. Reload clinical context");
      // Write the appointment to conflict with cancellation/reschedule/completion.
      const guarded = await db.Appointment.findOneAndUpdate(versionFilter(appointment, expected), { $inc: { __v: 1 } }, { session, new: true });
      if (!guarded) fail(409, "Appointment changed. Reload clinical context");
      let consultation = await db.Consultation.findOne({ appointment: appointmentId }).select("+clinicalNotes").session(session);
      const created = !consultation;
      if (consultation && (consultation.status !== "draft" || String(consultation.doctor) !== String(doctorId) || String(consultation.patient) !== String(appointment.patient))) fail(409, "Clinical record cannot be edited");
      if (!consultation) consultation = new db.Consultation({ appointment: appointmentId, doctor: doctorId, patient: appointment.patient });
      Object.assign(consultation, sanitizeConsultation(body)); await consultation.save({ session });
      await new db.AuditLog({ actor: doctorId, actorRole: "doctor", action: created ? "CONSULTATION_CREATED" : "CONSULTATION_UPDATED", targetType: "Consultation", targetId: consultation._id, patient: appointment.patient }).save({ session });
      return { message: "Consultation draft saved", consultation, appointmentVersion: guarded.__v };
    });
  };
  const voidPrescription = async ({ prescriptionId, doctorId, reason }) => {
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 1000) fail(400, "Void reason of 5–1000 characters is required");
    reason = reason.trim();
    return transaction(db, async session => {
      await lockDoctor(doctorId, session);
      const prescription = await db.Prescription.findOne({ _id: prescriptionId, doctor: doctorId }).session(session);
      if (!prescription) fail(404, "Prescription not found");
      if (prescription.status === "voided") {
        if (prescription.voidReason === reason) return prescription;
        fail(409, "Prescription is already voided");
      }
      if (!await db.Appointment.findOne({ _id: prescription.appointment, patient: prescription.patient, doctor: doctorId, status: "completed" }).session(session) ||
          !await db.Consultation.findOne({ _id: prescription.consultation, appointment: prescription.appointment, patient: prescription.patient, doctor: doctorId, status: "completed" }).session(session)) fail(409, "Prescription history is inconsistent");
      const updated = await db.Prescription.findOneAndUpdate({ _id: prescriptionId, doctor: doctorId, status: "active" }, { $set: { status: "voided", voidReason: reason, voidedAt: new Date() }, $inc: { __v: 1 } }, { session, new: true, runValidators: true });
      if (!updated) fail(409, "Prescription changed during voiding");
      await new db.AuditLog({ actor: doctorId, actorRole: "doctor", action: "PRESCRIPTION_VOIDED", targetType: "Prescription", targetId: prescriptionId, patient: prescription.patient, metadata: { reason } }).save({ session });
      await new db.Notification({ recipient: prescription.patient, type: "PRESCRIPTION_VOIDED", title: "Prescription voided", message: "Your doctor voided a prescription. Review its details.", link: "/patient/prescriptions" }).save({ session });
      return updated;
    });
  };
  const amendRecord = async ({ targetId, doctorId, text, requestId, prescription = false }) => {
    if (typeof text !== "string" || !text.trim() || text.trim().length > 4000) fail(400, "Amendment text of 1-4000 characters is required");
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId))) fail(400, "Invalid amendment request ID");
    text = text.trim();
    const id = crypto.createHash("sha256").update(`${targetId}:${doctorId}:${requestId || text}`).digest("hex").slice(0, 24);
    return transaction(db, async session => {
      await lockDoctor(doctorId, session);
      const Model = prescription ? db.Prescription : db.Consultation;
      const record = await Model.findOne({ _id: targetId, doctor: doctorId }).select(prescription ? "+amendments" : "+clinicalNotes").session(session);
      if (!record) fail(404, "Clinical record not found");
      const previous = record.amendments.find(item => String(item._id) === id);
      if (previous) {
        if (previous.text !== text || String(previous.author) !== String(doctorId)) fail(409, "Amendment request ID was used for different content");
        return previous;
      }
      if (record.status !== (prescription ? "active" : "completed")) fail(409, "Only issued active prescriptions or completed consultations can be amended");
      const appointment = await db.Appointment.findOne({ _id: record.appointment, doctor: doctorId, patient: record.patient, status: "completed" }).session(session);
      if (!appointment) fail(409, "Clinical record and appointment are inconsistent");
      if (prescription && !await db.Consultation.findOne({ _id: record.consultation, appointment: record.appointment, doctor: doctorId, patient: record.patient, status: "completed" }).session(session)) fail(409, "Prescription consultation is inconsistent");
      record.amendments.push({ _id: id, text, author: doctorId });
      await record.save({ session }); const amendment = record.amendments.at(-1);
      await new db.AuditLog({ actor: doctorId, actorRole: "doctor", action: prescription ? "PRESCRIPTION_AMENDED" : "CONSULTATION_AMENDED", targetType: prescription ? "Prescription" : "Consultation", targetId, patient: record.patient, metadata: { amendmentId: amendment._id } }).save({ session });
      await new db.Notification({ recipient: record.patient, type: prescription ? "PRESCRIPTION_AMENDED" : "CONSULTATION_AMENDED", title: "Clinical record updated", message: "Your doctor added an amendment. Review the updated history.", link: prescription ? "/patient/prescriptions" : "/patient/consultations" }).save({ session });
      return amendment;
    });
  };
  const amend = ({ consultationId, ...args }) => amendRecord({ targetId: consultationId, ...args });
  const amendPrescription = ({ prescriptionId, ...args }) => amendRecord({ targetId: prescriptionId, prescription: true, ...args });

  return { book, reschedule, cancel, availability, saveDraft, voidPrescription, amend, amendPrescription };
};
module.exports = { ...createSchedulingService(), createSchedulingService, version, runTransaction: transaction };
