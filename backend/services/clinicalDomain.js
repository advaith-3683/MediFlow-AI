const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const AuditLog = require("../models/AuditLog");
const { createStartAt } = require("./appointmentDomain");

const AUDIT_ACTIONS = ["APPOINTMENT_BOOKED", "APPOINTMENT_RESCHEDULED", "APPOINTMENT_CANCELLED", "CONSULTATION_CREATED", "CONSULTATION_UPDATED", "CONSULTATION_COMPLETED", "CONSULTATION_AMENDED", "PRESCRIPTION_CREATED", "PRESCRIPTION_AMENDED", "PRESCRIPTION_VOIDED", "MEDICAL_RECORD_VIEWED_BY_DOCTOR", "APPOINTMENT_COMPLETED", "DOCTOR_PROFILE_UPDATED", "DOCTOR_AVAILABILITY_UPDATED", "ADMIN_USER_DISABLED", "ADMIN_USER_REACTIVATED", "DOCTOR_VERIFIED", "DOCTOR_REJECTED", "ADMIN_APPOINTMENT_CANCELLED"];
const text = (value, max) => String(value || "").trim().slice(0, max);
const assertObjectId = (value, label = "ID") => { if (!mongoose.isValidObjectId(value)) { const error = new Error(`Invalid ${label}`); error.status = 400; throw error; } };
const assertTransition = (from, to) => { if (from === "completed" || !["draft", "completed"].includes(to)) { const error = new Error("Invalid consultation status transition"); error.status = 409; throw error; } };
const assertPatientOwnership = (entity, patientId) => { if (!entity || String(entity.patient?._id || entity.patient) !== String(patientId)) { const error = new Error("Clinical record not found"); error.status = 404; throw error; } };
const assertAssignedAppointment = async (appointmentId, doctorId) => {
  assertObjectId(appointmentId, "appointment ID");
  const appointment = await Appointment.findOne({ _id: appointmentId, doctor: doctorId }).populate("patient", "name email phone").populate("doctor", "name specialty");
  if (!appointment) { const error = new Error("Appointment not found"); error.status = 404; throw error; }
  return appointment;
};
const hasClinicalRelationship = async (doctorId, patientId) => Boolean(await Appointment.exists({ doctor: doctorId, patient: patientId, status: { $in: ["scheduled", "completed"] } }));
const sanitizeConsultation = (body) => ({
  chiefComplaint: text(body.chiefComplaint, 2000), symptoms: text(body.symptoms, 4000), clinicalNotes: text(body.clinicalNotes, 10000), diagnosis: text(body.diagnosis, 4000), advice: text(body.advice, 4000), followUpInstructions: text(body.followUpInstructions, 4000),
  vitals: Object.fromEntries(Object.entries(body.vitals || {}).filter(([key, value]) => ["temperatureC", "pulseBpm", "systolicBp", "diastolicBp", "oxygenSaturation", "weightKg"].includes(key) && value !== "" && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])),
});
const sanitizePrescription = (body) => {
  const medications = Array.isArray(body.medications) ? body.medications.slice(0, 20).map((item) => ({ medicineName: text(item.medicineName, 200), dosage: text(item.dosage, 100), frequency: text(item.frequency, 100), duration: text(item.duration, 100), instructions: text(item.instructions, 500) })) : [];
  if (medications.some((item) => !item.medicineName || !item.dosage || !item.frequency || !item.duration)) { const error = new Error("Every medication requires name, dosage, frequency, and duration"); error.status = 400; throw error; }
  const followUpDate = body.followUpDate ? new Date(body.followUpDate) : null;
  if (followUpDate && (Number.isNaN(followUpDate.getTime()) || followUpDate < new Date())) { const error = new Error("Follow-up date must be valid and in the future"); error.status = 400; throw error; }
  return { medications, generalInstructions: text(body.generalInstructions, 4000), followUpDate };
};
const validateAvailability = (availability, unavailableDates) => {
  if (!Array.isArray(availability) || availability.length > 7 || new Set(availability.map((item) => Number(item?.weekday))).size !== availability.length || availability.some((item) => !item || typeof item.startTime !== "string" || typeof item.endTime !== "string" || !Number.isInteger(Number(item.weekday)) || Number(item.weekday) < 0 || Number(item.weekday) > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime) || item.startTime >= item.endTime || !Number.isInteger(Number(item.appointmentDurationMinutes)) || Number(item.appointmentDurationMinutes) < 10 || Number(item.appointmentDurationMinutes) > 240) || !Array.isArray(unavailableDates) || unavailableDates.some((date) => typeof date !== "string" || !createStartAt(date, "12:00"))) { const error = new Error("Invalid availability schedule"); error.status = 400; throw error; }
  return { availability: availability.map((item) => ({ weekday: Number(item.weekday), startTime: item.startTime, endTime: item.endTime, appointmentDurationMinutes: Number(item.appointmentDurationMinutes) })), unavailableDates: [...new Set(unavailableDates.map(String))] };
};
const completeClinicalState = (consultation, appointment, completedAt = new Date()) => {
  assertTransition(consultation.status, "completed");
  consultation.status = "completed"; consultation.completedAt = completedAt; appointment.status = "completed";
};
const buildPrescriptionRecord = ({ values, appointment, consultation, doctorId }) => ({ ...values, patient: appointment.patient._id || appointment.patient, doctor: doctorId, consultation: consultation._id, appointment: appointment._id });
const prescriptionSafetyWarnings = (medications, safetyProfile = {}) => {
  const names = (medications || []).map((item) => String(item.medicineName || "").trim().toLowerCase()).filter(Boolean);
  const allergies = (safetyProfile.allergies || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  const warnings = [];
  const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  duplicateNames.forEach((name) => warnings.push({ type: "duplicate", message: `Duplicate medication entry: ${name}` }));
  names.filter((name) => allergies.includes(name)).forEach((name) => warnings.push({ type: "allergy-name-match", message: `Medication name exactly matches patient-reported allergy: ${name}` }));
  return warnings;
};
const writeAudit = async ({ actor, actorRole, action, targetType, targetId, patient, metadata = {} }) => {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error("Unsupported audit action");
  return AuditLog.create({ actor, actorRole, action, targetType, targetId, patient, metadata });
};

module.exports = { AUDIT_ACTIONS, assertObjectId, assertTransition, assertPatientOwnership, assertAssignedAppointment, hasClinicalRelationship, sanitizeConsultation, sanitizePrescription, validateAvailability, completeClinicalState, buildPrescriptionRecord, prescriptionSafetyWarnings, writeAudit };
