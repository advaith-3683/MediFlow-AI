const crypto = require("crypto");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { AppError } = require("../middleware/errorHandler");
const { assertObjectId, prescriptionSafetyWarnings } = require("./clinicalDomain");

const invalid = (message) => { throw new AppError(400, message, "INVALID_COMPLETION"); };
const conflict = (message) => { throw new AppError(409, message, "COMPLETION_CONFLICT"); };
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fields = { chiefComplaint: 2000, symptoms: 4000, clinicalNotes: 10000, diagnosis: 4000, advice: 4000, followUpInstructions: 4000 };
const medicationFields = { medicineName: 200, dosage: 100, frequency: 100, duration: 100, instructions: 500 };
const vitals = ["temperatureC", "pulseBpm", "systolicBp", "diastolicBp", "oxygenSaturation", "weightKg"];
const cleanText = (value, max, label) => {
  if (typeof value !== "string" || value.trim().length > max) invalid(`Invalid ${label}`);
  return value.trim();
};

// Unlike the draft sanitizers, completion never silently truncates clinical data
// or drops invalid measurements. Omitted fields preserve the stored draft.
const normalizeInput = (body = {}) => {
  if (!object(body)) invalid("Completion data must be an object");
  const notes = body.consultation === undefined ? {} : body.consultation;
  const prescription = body.prescription === undefined ? {} : body.prescription;
  if (!object(notes) || !object(prescription)) invalid("Invalid consultation or prescription");
  const consultation = {};
  for (const [key, max] of Object.entries(fields)) {
    if (Object.hasOwn(notes, key)) consultation[key] = cleanText(notes[key], max, key);
  }
  if (Object.hasOwn(notes, "vitals")) {
    if (!object(notes.vitals)) invalid("Invalid vitals");
    consultation.vitals = {};
    for (const [key, value] of Object.entries(notes.vitals)) {
      if (!vitals.includes(key)) invalid("Invalid vital measurement");
      if (value === "") continue;
      if (!["string", "number"].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value))) invalid("Invalid vital measurement");
      consultation.vitals[key] = Number(value);
    }
  }
  const list = prescription.medications === undefined ? [] : prescription.medications;
  if (!Array.isArray(list) || list.length > 20) invalid("A prescription can contain at most 20 medications");
  const medications = list.map((item) => {
    if (!object(item)) invalid("Invalid medication");
    return Object.fromEntries(Object.entries(medicationFields).map(([key, max]) => {
      const value = cleanText(item[key] === undefined ? "" : item[key], max, key);
      if (key !== "instructions" && !value) invalid("Every medication requires name, dosage, frequency, and duration");
      return [key, value];
    }));
  });
  const generalInstructions = cleanText(prescription.generalInstructions === undefined ? "" : prescription.generalInstructions, 4000, "general instructions");
  let followUpDate = null;
  if (prescription.followUpDate !== undefined && prescription.followUpDate !== null && prescription.followUpDate !== "") {
    if (typeof prescription.followUpDate !== "string") invalid("Invalid follow-up date");
    const date = new Date(prescription.followUpDate);
    if (Number.isNaN(date.getTime())) invalid("Invalid follow-up date");
    followUpDate = date.toISOString();
  }
  return { consultation, prescription: { medications, generalInstructions, followUpDate } };
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const inputHash = (input) => crypto.createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
const sameId = (left, right) => String(left) === String(right);
const publicConsultation = (consultation) => {
  const value = consultation.toObject();
  delete value.completionRequestHash;
  delete value.completionPrescription;
  delete value.completionSafetyWarnings;
  return value;
};
const populateAppointment = (appointment, session) => appointment.populate([
  { path: "patient", select: "name email phone", ordered: true, options: { session } },
  { path: "doctor", select: "name specialty", ordered: true, options: { session } },
]);

// Dependency injection is only for database-free tests. Production uses the
// existing models on one connection; no non-transactional fallback exists.
const createCompletionService = (dependencies = {}) => {
  const db = { mongoose, Appointment, Consultation, Prescription, User, AuditLog, Notification, ...dependencies };
  return async ({ appointmentId, doctorId, body }) => {
    assertObjectId(appointmentId, "appointment ID");
    const input = normalizeInput(body);
    const hash = inputHash(input);
    // The driver retries transient failures and uncertain commits. A duplicate
    // insert can be caused by a competing draft/completion; re-read once in a
    // fresh transaction rather than continuing an aborted transaction.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await db.mongoose.startSession();
      try {
        return await session.withTransaction(async () => {
          // All attempt-local documents are reloaded on every callback retry.
          const doctor = await db.User.findOne({ _id: doctorId, role: "doctor", accountStatus: { $ne: "disabled" }, $or: [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }] }).session(session);
          if (!doctor) throw new AppError(403, "Doctor verification is required");
          const appointment = await db.Appointment.findOne({ _id: appointmentId, doctor: doctorId }).session(session);
          if (!appointment) throw new AppError(404, "Appointment not found");
          let consultation = await db.Consultation.findOne({ appointment: appointmentId }).select("+clinicalNotes +completionRequestHash +completionPrescription +completionSafetyWarnings").session(session);
          const existingPrescription = await db.Prescription.findOne({ appointment: appointmentId }).session(session);
          if (consultation && (!sameId(consultation.doctor, doctorId) || !sameId(consultation.patient, appointment.patient))) conflict("Consultation ownership is inconsistent");
          if (appointment.status === "completed") {
            if (consultation?.status !== "completed" || consultation.completionRequestHash !== hash) conflict("Appointment is already completed; use amendments for changes");
            if (Boolean(consultation.completionPrescription) !== Boolean(existingPrescription) || (existingPrescription && !sameId(existingPrescription._id, consultation.completionPrescription))) conflict("Committed prescription history is inconsistent");
            if (existingPrescription && (!sameId(existingPrescription.doctor, doctorId) || !sameId(existingPrescription.patient, appointment.patient) || !sameId(existingPrescription.consultation, consultation._id))) conflict("Prescription ownership is inconsistent");
            await populateAppointment(appointment, session);
            return { message: "Consultation completed", consultation: publicConsultation(consultation), prescription: existingPrescription, appointment, safetyWarnings: consultation.completionSafetyWarnings || [] };
          }
          if (appointment.status !== "scheduled" || (consultation && consultation.status !== "draft")) conflict("Only scheduled appointments with an editable consultation can be completed");
          if (!Number.isSafeInteger(body.appointmentVersion) || body.appointmentVersion < 0) throw new AppError(400, "An appointment version is required. Reload clinical context", "APPOINTMENT_VERSION_REQUIRED");
          if ((appointment.__v || 0) !== body.appointmentVersion) conflict("Appointment changed. Reload clinical context before completion");
          // Never upsert over an issued/voided prescription or delete history.
          if (existingPrescription) conflict("An existing prescription requires clinical review before completion");
          const patient = await db.User.findById(appointment.patient).select("safetyProfile").session(session);
          if (!patient) conflict("Patient account no longer exists");
          if (input.prescription.followUpDate && new Date(input.prescription.followUpDate) < new Date()) invalid("Follow-up date must be in the future");
          if (!consultation) consultation = new db.Consultation({ appointment: appointment._id, patient: appointment.patient, doctor: doctorId });
          Object.assign(consultation, input.consultation);
          if (!consultation.chiefComplaint || !consultation.diagnosis || !consultation.advice) invalid("Chief complaint, assessment, and advice are required to complete a consultation");
          consultation.status = "completed";
          consultation.completedAt = new Date();
          consultation.completionRequestHash = hash;
          const safetyWarnings = prescriptionSafetyWarnings(input.prescription.medications, patient.safetyProfile);
          consultation.completionSafetyWarnings = safetyWarnings;
          const prescription = input.prescription.medications.length || input.prescription.generalInstructions
            ? new db.Prescription({ ...input.prescription, patient: appointment.patient, doctor: doctorId, consultation: consultation._id, appointment: appointment._id }) : null;
          consultation.completionPrescription = prescription?._id || null;
          const auditBase = { actor: doctorId, actorRole: "doctor", patient: appointment.patient };
          const events = [
            new db.AuditLog({ ...auditBase, action: "CONSULTATION_COMPLETED", targetType: "Consultation", targetId: consultation._id, metadata: { appointmentId: appointment._id } }),
            new db.AuditLog({ ...auditBase, action: "APPOINTMENT_COMPLETED", targetType: "Appointment", targetId: appointment._id }),
          ];
          if (prescription) events.push(new db.AuditLog({ ...auditBase, action: "PRESCRIPTION_CREATED", targetType: "Prescription", targetId: prescription._id, metadata: { appointmentId: appointment._id } }));
          const notification = new db.Notification({ recipient: appointment.patient, type: "CONSULTATION_COMPLETED", title: "Consultation completed", message: prescription ? "Your consultation is complete and a prescription was issued." : "Your consultation is complete.", link: prescription ? "/patient/prescriptions" : "/patient/consultations" });
          // Validate every candidate before the first write. Sequential operations
          // are required on a transaction session (no Promise.all).
          await consultation.validate();
          if (prescription) await prescription.validate();
          for (const event of events) await event.validate();
          await notification.validate();
          const completed = await db.Appointment.findOneAndUpdate(
            { _id: appointment._id, doctor: doctorId, status: "scheduled" },
            { $set: { status: "completed" }, $inc: { __v: 1 } }, { session, new: true, runValidators: true },
          );
          if (!completed) conflict("Appointment is no longer scheduled");
          await consultation.save({ session });
          if (prescription) await prescription.save({ session });
          for (const event of events) await event.save({ session });
          // This is the durable in-app notification itself, visible to polling
          // only after commit. No network delivery or swallowed post-commit write.
          await notification.save({ session });
          await populateAppointment(completed, session);
          return { message: "Consultation completed", consultation: publicConsultation(consultation), prescription, appointment: completed, safetyWarnings };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
      } catch (error) {
        if (error.code === 11000) {
          if (attempt === 0) continue;
          conflict("Conflicting clinical records; reload before retrying completion");
        }
        if ([20, 303].includes(error.code)) throw new AppError(503, "Consultation completion requires MongoDB transaction support", "TRANSACTIONS_REQUIRED");
        if (error.name === "VersionError") conflict("Consultation changed during completion; reload before retrying");
        if (error.hasErrorLabel?.("UnknownTransactionCommitResult")) throw new AppError(503, "Completion outcome is uncertain; retry the identical request", "COMPLETION_OUTCOME_UNKNOWN");
        throw error;
      } finally {
        await session.endSession();
      }
    }
  };
};

module.exports = { completeConsultation: createCompletionService(), createCompletionService, normalizeInput };
