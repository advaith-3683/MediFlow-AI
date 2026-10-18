const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const MedicalRecord = require("../models/MedicalRecord");
const User = require("../models/User");
const Prescription = require("../models/Prescription");
const Consultation = require("../models/Consultation");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { SPECIALTIES, normalizeSpecialty, DATE_PATTERN, createStartAt, legacyStartAt } = require("../services/appointmentDomain");
const { findDoctors, approvedDoctorFilter } = require("../services/doctorRecommendations");
const { slotsForDate } = require("../services/appointmentSlots");
const { EMERGENCY_GUIDANCE } = require("../services/triageService");
const scheduling = require("../services/scheduling");
const { visibleRecordFilter } = require("../services/medicalFiles");

const router = express.Router();
router.use(authMiddleware, authorizeRoles("patient"));
const population = [{ path: "doctor", select: "name email specialty" }];

router.get("/doctors", async (req, res, next) => {
  try {
    const requestedSpecialty = String(req.query.specialty || "").trim();
    const specialty = requestedSpecialty ? normalizeSpecialty(requestedSpecialty) : null;
    if (requestedSpecialty && !specialty) return res.status(400).json({ message: "Choose a supported specialty" });
    res.json(await findDoctors({ specialties: specialty ? [specialty] : SPECIALTIES, patientId: req.user.id }));
  } catch (error) { next(error); }
});

router.get("/doctors/:id/slots", async (req, res, next) => {
  try {
    const date = String(req.query.date || "");
    if (!mongoose.isValidObjectId(req.params.id) || !DATE_PATTERN.test(date) || !createStartAt(date, "12:00")) return res.status(400).json({ message: "A valid doctor and date are required" });
    const doctor = await User.findOne({ _id: req.params.id, ...approvedDoctorFilter() });
    if (!doctor) return res.status(404).json({ message: "Verified doctor not found" });
    const exclude = req.query.excludeAppointmentId;
    if (exclude && (!mongoose.isValidObjectId(exclude) || !await Appointment.exists({ _id: exclude, patient: req.user.id, doctor: doctor._id, status: "scheduled" }))) return res.status(404).json({ message: "Appointment not found" });
    const dayStart = createStartAt(date, "00:00");
    const existing = await Appointment.find({ ...(exclude ? { _id: { $ne: exclude } } : {}), $or: [{ doctor: doctor._id }, { patient: req.user.id }], status: "scheduled", $and: [{ $or: [{ startAt: { $gte: new Date(dayStart.getTime() - 240 * 60000), $lt: new Date(dayStart.getTime() + 24 * 60 * 60_000) } }, { startAt: null }] }] }).select("startAt durationMinutes appointmentDate appointmentTime").lean();
    res.json(slotsForDate(doctor, date, existing));
  } catch (error) { next(error); }
});

router.get("/my", async (req, res, next) => {
  try {
    const appointments = await Appointment.find({ patient: req.user.id }).populate(population).sort({ startAt: 1, appointmentDate: 1 }).lean();
    res.json(appointments.map((item) => ({ ...item, startAt: legacyStartAt(item) })));
  } catch (error) { next(error); }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const now = new Date();
    const [upcomingCount, recordsCount, prescriptionCount, completedConsultations, nextAppointment] = await Promise.all([
      Appointment.countDocuments({ patient: req.user.id, status: "scheduled", startAt: { $gt: now } }),
      MedicalRecord.countDocuments({ patient: req.user.id, ...visibleRecordFilter() }),
      Prescription.countDocuments({ patient: req.user.id }),
      Consultation.countDocuments({ patient: req.user.id, status: "completed" }),
      Appointment.findOne({ patient: req.user.id, status: "scheduled", startAt: { $gt: now } }).populate(population).sort({ startAt: 1 }).lean(),
    ]);
    res.json({ upcomingAppointments: upcomingCount, medicalRecords: recordsCount, prescriptions: prescriptionCount, completedConsultations, nextAppointment });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    if (req.body.priority === "emergency") return res.status(409).json({ message: EMERGENCY_GUIDANCE, code: "EMERGENCY_CARE_REQUIRED" });
    const result = await scheduling.book({ patientId: req.user.id, body: req.body });
    res.status(result.replayed ? 200 : 201).json({ message: "Appointment booked successfully", appointment: result.appointment });
  } catch (error) { next(error); }
});

router.patch("/:id/reschedule", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID" });
    const appointment = await scheduling.reschedule({ appointmentId: req.params.id, patientId: req.user.id, body: req.body });
    res.json({ message: "Appointment rescheduled", appointment });
  } catch (error) { next(error); }
});

router.patch("/:id/cancel", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID" });
    const appointment = await scheduling.cancel({ appointmentId: req.params.id, actorId: req.user.id, actorRole: "patient", appointmentVersion: req.body?.appointmentVersion });
    res.json({ message: "Appointment cancelled successfully", appointment });
  } catch (error) { next(error); }
});

module.exports = router;
