const express = require("express");
const Consultation = require("../models/Consultation");
const MedicalRecord = require("../models/MedicalRecord");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const scheduling = require("../services/scheduling");
const { assertObjectId, assertAssignedAppointment, hasClinicalRelationship, sanitizePrescription, prescriptionSafetyWarnings, writeAudit } = require("../services/clinicalDomain");
const { completeConsultation } = require("../services/consultationCompletion");
const { cleanInput, generate } = require("../services/aiService");
const { aiProtection } = require("../middleware/aiProtection");
const { SAFETY_INSTRUCTION, validateGuidance } = require("../services/aiSafety");
const { loadClinicalHistory } = require("../services/clinicalHistory");

const router = express.Router();
router.use(authMiddleware, authorizeRoles("doctor"));
const { visibleRecordFilter, sendMedicalFile, createFileStore } = require("../services/medicalFiles");
const requireVerifiedDoctor = async (req, res, next) => {
  const doctor = await User.findOne({ _id: req.user.id, role: "doctor", accountStatus: { $ne: "disabled" }, $or: [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }] });
  if (!doctor) return res.status(403).json({ message: "Doctor verification is required" });
  req.doctor = doctor; next();
};
router.use(requireVerifiedDoctor);

router.get("/appointments/:id/context", async (req, res, next) => {
  try {
    const appointment = await assertAssignedAppointment(req.params.id, req.user.id);
    if (appointment.status === "cancelled") return res.status(409).json({ message: "Cancelled appointments cannot have an editable consultation" });
    const [consultation, records, history] = await Promise.all([
      Consultation.findOne({ appointment: appointment._id, doctor: req.user.id }).select("+clinicalNotes").lean(),
      MedicalRecord.find({ patient: appointment.patient._id, ...visibleRecordFilter() }).select("title description doctor recordType createdAt fileUrl").sort({ createdAt: -1 }).lean(),
      loadClinicalHistory(appointment.patient._id),
    ]);
    const prescriptions = history.prescriptions;
    if ((appointment.status === "completed" && consultation?.status !== "completed") || (consultation && (String(consultation.patient) !== String(appointment.patient._id) || consultation.status !== (appointment.status === "completed" ? "completed" : "draft")))) return res.status(409).json({ message: "Clinical record and appointment are inconsistent" });
    const previousConsultations = history.consultations.filter(item => String(item.doctor?._id || item.doctor) === req.user.id && String(item.appointment?._id || item.appointment) !== String(appointment._id));
    const patientSafety = await User.findById(appointment.patient._id).select("safetyProfile").lean();
    await writeAudit({ actor: req.user.id, actorRole: "doctor", action: "MEDICAL_RECORD_VIEWED_BY_DOCTOR", targetType: "Appointment", targetId: appointment._id, patient: appointment.patient._id, metadata: { access: "context", recordCount: records.length } });
    res.json({ appointment, consultation, safetyProfile: { ...patientSafety?.safetyProfile, label: "Patient-reported information" }, records: records.map(({ fileUrl, ...record }) => ({ ...record, hasFile: Boolean(fileUrl) })), prescriptions, previousConsultations });
  } catch (error) { next(error); }
});

router.put("/appointments/:id/consultation", async (req, res, next) => {
  try {
    assertObjectId(req.params.id, "appointment ID");
    res.json(await scheduling.saveDraft({ appointmentId: req.params.id, doctorId: req.user.id, body: req.body }));
  } catch (error) { next(error); }
});

router.post("/appointments/:id/complete", async (req, res, next) => {
  try {
    res.json(await completeConsultation({ appointmentId: req.params.id, doctorId: req.user.id, body: req.body }));
  } catch (error) { next(error); }
});

router.post("/prescription-safety-warnings", async (req, res, next) => { try { assertObjectId(req.body.appointmentId, "appointment ID"); const appointment = await assertAssignedAppointment(req.body.appointmentId, req.user.id); const patient = await User.findById(appointment.patient._id).select("safetyProfile").lean(); const values = sanitizePrescription({ medications: req.body.medications || [] }); res.json({ warnings: prescriptionSafetyWarnings(values.medications, patient.safetyProfile), disclaimer: "Safety reminder — verify clinically. This is not a comprehensive interaction check." }); } catch (error) { next(error); } });

router.post("/consultations/:id/amendments", async (req, res, next) => {
  try {
    assertObjectId(req.params.id, "consultation ID");
    const amendment = await scheduling.amend({ consultationId: req.params.id, doctorId: req.user.id, text: req.body.text, requestId: req.body.requestId });
    res.status(201).json({ message: "Amendment appended", amendment });
  } catch (error) { next(error); }
});
router.get("/patients/:patientId/history", async (req, res, next) => {
  try {
    assertObjectId(req.params.patientId, "patient ID");
    if (!(await hasClinicalRelationship(req.user.id, req.params.patientId))) return res.status(403).json({ message: "No clinical relationship with this patient" });
    const history = await loadClinicalHistory(req.params.patientId);
    res.json({ prescriptions: history.prescriptions, consultations: history.consultations.filter(item => String(item.doctor?._id || item.doctor) === req.user.id) });
  } catch (error) { next(error); }
});
router.post("/prescriptions/:id/amendments", async (req, res, next) => {
  try {
    assertObjectId(req.params.id, "prescription ID");
    const amendment = await scheduling.amendPrescription({ prescriptionId: req.params.id, doctorId: req.user.id, text: req.body.text, requestId: req.body.requestId });
    res.status(201).json({ message: "Prescription amendment appended", amendment });
  } catch (error) { next(error); }
});

router.post("/prescriptions/:id/void", async (req, res, next) => {
  try {
    assertObjectId(req.params.id, "prescription ID");
    const prescription = await scheduling.voidPrescription({ prescriptionId: req.params.id, doctorId: req.user.id, reason: req.body.reason });
    res.json({ message: "Prescription voided", prescription });
  } catch (error) { next(error); }
});

router.post("/ai-assist", ...aiProtection, async (req, res, next) => {
  try {
    const roughNotes = cleanInput(req.body?.roughNotes, "Clinical notes", 6000);
    const task = ["format", "summarize", "questions"].includes(req.body?.task) ? req.body?.task : "format";
    
    const systemInstruction = `${SAFETY_INSTRUCTION} You are a clinical documentation assistant. ${task === "questions" ? "Suggest concise follow-up questions" : task === "summarize" ? "Create a concise neutral summary" : "Organize the notes into chief complaint, symptoms, observations, assessment, advice, and follow-up sections"}. Do not prescribe medication. Do not add facts, finalize a diagnosis, or claim certainty. Clearly preserve uncertainty. Return documentation text only. Never add identifying details or copy user instructions into guidance.`;
    const suggestion = validateGuidance(await generate({ prompt: roughNotes, systemInstruction }));
    res.json({ suggestion, aiGenerated: true, disclaimer: "Documentation assistance only. The clinician must verify every statement before use." });
  } catch (error) { next(error); } finally { req.aiRelease?.(); }
});

router.get("/patients/:patientId/records/:recordId/file", async (req, res, next) => {
  try {
    assertObjectId(req.params.patientId, "patient ID"); assertObjectId(req.params.recordId, "record ID");
    if (!(await hasClinicalRelationship(req.user.id, req.params.patientId))) return res.status(403).json({ message: "No clinical relationship with this patient" });
    const record = await MedicalRecord.findOne({ _id: req.params.recordId, patient: req.params.patientId, ...visibleRecordFilter() }).select("+fileSha256");
    if (!record?.fileUrl) return res.status(404).json({ message: "Medical file not found" });
    const store = createFileStore(); const file = await store.read(record);
    await writeAudit({ actor: req.user.id, actorRole: "doctor", action: "MEDICAL_RECORD_VIEWED_BY_DOCTOR", targetType: "MedicalRecord", targetId: record._id, patient: record.patient, metadata: { access: "file" } });
    await sendMedicalFile(record, req, res, store, file);

  } catch (error) { next(error); }
});

router.get("/availability", (req, res) => res.json({ availability: req.doctor.availability, unavailableDates: req.doctor.unavailableDates, timezone: req.doctor.timezone }));
router.patch("/availability", async (req, res, next) => {
  try {
    res.json(await scheduling.availability({ doctorId: req.user.id, body: req.body }));
  } catch (error) {
    if (error.code === "AVAILABILITY_CONFLICT") return res.status(409).json({ message: error.message, conflictCount: error.conflictCount });
    next(error);
  }
});

router.get("/profile", (req, res) => res.json({ id: req.doctor._id, name: req.doctor.name, email: req.doctor.email, specialty: req.doctor.specialty, isDoctorVerified: req.doctor.isDoctorVerified, bio: req.doctor.bio, languages: req.doctor.languages, consultationFee: req.doctor.consultationFee, qualifications: req.doctor.qualifications, experienceYears: req.doctor.experienceYears }));
router.patch("/profile", async (req, res, next) => {
  try {
    req.doctor.bio = String(req.body.bio || "").trim().slice(0, 1000);
    req.doctor.languages = Array.isArray(req.body.languages) ? req.body.languages.slice(0, 10).map((value) => String(value).trim().slice(0, 50)).filter(Boolean) : [];
    req.doctor.qualifications = Array.isArray(req.body.qualifications) ? req.body.qualifications.slice(0, 10).map((value) => String(value).trim().slice(0, 100)).filter(Boolean) : [];
    req.doctor.consultationFee = Number(req.body.consultationFee); req.doctor.experienceYears = Number(req.body.experienceYears);
    await req.doctor.save();
    await writeAudit({ actor: req.user.id, actorRole: "doctor", action: "DOCTOR_PROFILE_UPDATED", targetType: "User", targetId: req.doctor._id });
    res.json({ message: "Doctor profile updated" });
  } catch (error) { next(error); }
});

module.exports = router;
