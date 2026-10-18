const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const User = require("../models/User");
const Consultation = require("../models/Consultation");
const scheduling = require("../services/scheduling");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { createStartAt, localDateKey } = require("../services/appointmentDomain");

const router = express.Router();
router.use(authMiddleware, authorizeRoles("doctor"));
const populate = [{ path: "patient", select: "name email phone" }, { path: "doctor", select: "name specialty" }];
const verifiedDoctor = async (userId) => User.findOne({ _id: userId, role: "doctor", accountStatus: { $ne: "disabled" }, $or: [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }] });
router.use(async (req, res, next) => {
  try {
    const doctor = await verifiedDoctor(req.user.id);
    if (!doctor) return res.status(403).json({ message: "Doctor verification is required" });
    req.doctor = doctor;
    next();
  } catch (error) { next(error); }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const doctor = req.doctor;
    const now = new Date();
    const todayStart = createStartAt(localDateKey(now), "00:00");
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);
    const [today, upcomingCount, completedConsultations, patientsSeen] = await Promise.all([
      Appointment.find({ doctor: req.user.id, status: "scheduled", startAt: { $gte: todayStart, $lt: todayEnd } }).populate(populate).sort({ startAt: 1 }).lean(),
      Appointment.countDocuments({ doctor: req.user.id, status: "scheduled", startAt: { $gte: now } }),
      Consultation.countDocuments({ doctor: req.user.id, status: "completed" }),
      Consultation.distinct("patient", { doctor: req.user.id, status: "completed" }).then((items) => items.length),
    ]);
    const consultationMap = new Map((await Consultation.find({ appointment: { $in: today.map((item) => item._id) } }).select("appointment status").lean()).map((item) => [String(item.appointment), item.status]));
    res.json({ doctor: { id: doctor._id, name: doctor.name, specialty: doctor.specialty }, todayCount: today.length, upcomingCount, completedConsultations, patientsSeen, today: today.map((item) => ({ ...item, consultationStatus: consultationMap.get(String(item._id)) || null })) });
  } catch (error) { next(error); }
});

router.get("/", async (req, res, next) => {
  try {
    const appointments = await Appointment.find({ doctor: req.user.id }).populate(populate).sort({ startAt: 1 }).lean();
    res.json(appointments);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID" });
    const appointment = await Appointment.findOne({ _id: req.params.id, doctor: req.user.id }).populate(populate);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    res.json(appointment);
  } catch (error) { next(error); }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID" });
    if (req.body?.status === "completed") return res.status(400).json({ message: "Appointments must be completed through the clinical completion workflow" });
    if (req.body?.status !== "cancelled") return res.status(400).json({ message: "Status must be cancelled" });
    const cancelled = await scheduling.cancel({ appointmentId: req.params.id, actorId: req.user.id, actorRole: "doctor", appointmentVersion: req.body.appointmentVersion });
    res.json({ message: "Appointment marked cancelled", appointment: cancelled });
  } catch (error) { next(error); }
});

module.exports = router;
