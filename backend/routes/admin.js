const scheduling = require("../services/scheduling");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const MedicalRecord = require("../models/MedicalRecord");
const AuditLog = require("../models/AuditLog");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { SPECIALTIES } = require("../services/appointmentDomain");
const adminActions = require("../services/adminActions");
const { visibleRecordFilter } = require("../services/medicalFiles");

const router = express.Router();
router.use(authMiddleware, authorizeRoles("admin"));
const safeUserFields = "_id name email phone role isVerified accountStatus isDoctorVerified doctorVerificationStatus doctorVerificationReason specialty qualifications experienceYears languages bio licenseNumber facilityName createdAt";
const { pageValues, dateRange } = require("../services/adminQueries");
const validId = (id) => mongoose.isValidObjectId(id);

router.get("/dashboard", async (_req, res, next) => { try {
  const [totalPatients, totalDoctors, verifiedDoctors, pendingDoctors, totalAppointments, scheduledAppointments, completedAppointments, cancelledAppointments, medicalRecords, consultations, prescriptions, recentActivity] = await Promise.all([
    User.countDocuments({ role: "patient" }), User.countDocuments({ role: "doctor" }), User.countDocuments({ role: "doctor", $or: [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }] }), User.countDocuments({ role: "doctor", doctorVerificationStatus: "pending" }), Appointment.countDocuments(), Appointment.countDocuments({ status: "scheduled" }), Appointment.countDocuments({ status: "completed" }), Appointment.countDocuments({ status: "cancelled" }), MedicalRecord.countDocuments(visibleRecordFilter()), Consultation.countDocuments({ status: "completed" }), Prescription.countDocuments(), AuditLog.find().populate("actor", "name email role").sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  res.json({ metrics: { totalPatients, totalDoctors, verifiedDoctors, pendingDoctors, totalAppointments, scheduledAppointments, completedAppointments, cancelledAppointments, medicalRecords, consultations, prescriptions }, recentActivity });
} catch (error) { next(error); } });

router.get("/users", async (req, res, next) => { try {
  const { page, limit } = pageValues(req.query); const filter = {}; const search = String(req.query.search || "").trim().slice(0, 100);
  if (["patient", "doctor", "admin"].includes(req.query.role)) filter.role = req.query.role;
  if (["active", "disabled"].includes(req.query.accountStatus)) filter.accountStatus = req.query.accountStatus;
  if (["true", "false"].includes(req.query.isVerified)) filter.isVerified = req.query.isVerified === "true";
  if (search) filter.$or = [{ name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }];
  const [users, total] = await Promise.all([User.find(filter).select(safeUserFields).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  res.json({ users, page, limit, total, pages: Math.ceil(total / limit) });
} catch (error) { next(error); } });
router.get("/users/:id", async (req, res, next) => { try { if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid user ID" }); const user = await User.findById(req.params.id).select(safeUserFields).lean(); if (!user) return res.status(404).json({ message: "User not found" }); res.json(user); } catch (error) { next(error); } });
router.patch("/users/:id/status", async (req, res, next) => { try {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Valid user ID is required" });
  res.json(await adminActions.status({ actorId: req.user.id, targetId: req.params.id, accountStatus: req.body?.accountStatus }));
} catch (error) { next(error); } });

router.get("/doctors", async (req, res, next) => { try { const status = ["pending", "verified", "rejected"].includes(req.query.status) ? req.query.status : null; const filter = { role: "doctor" }; if (status === "verified") filter.$or = [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }]; else if (status) filter.doctorVerificationStatus = status; res.json(await User.find(filter).select(safeUserFields).sort({ createdAt: -1 }).lean()); } catch (error) { next(error); } });
router.patch("/doctors/:id/verification", async (req, res, next) => { try {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Valid doctor ID is required" });
  res.json(await adminActions.verification({ actorId: req.user.id, targetId: req.params.id, status: req.body?.status, specialty: req.body?.specialty, reason: req.body?.reason }));
} catch (error) { next(error); } });

router.get("/appointments", async (req, res, next) => { try { const { page, limit } = pageValues(req.query); const filter = {}; if (["scheduled", "completed", "cancelled"].includes(req.query.status)) filter.status = req.query.status; if (["normal", "urgent", "emergency"].includes(req.query.priority)) filter.priority = req.query.priority; if (SPECIALTIES.includes(req.query.specialty)) filter.specialty = req.query.specialty; if (validId(req.query.doctor)) filter.doctor = req.query.doctor; if (req.query.dateFrom || req.query.dateTo) filter.startAt = dateRange(req.query); const [appointments, total] = await Promise.all([Appointment.find(filter).populate("patient", "name email").populate("doctor", "name specialty").sort({ startAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Appointment.countDocuments(filter)]); res.json({ appointments, total, page, pages: Math.ceil(total / limit) }); } catch (error) { next(error); } });
router.patch("/appointments/:id/cancel", async (req, res, next) => { try { const reason = String(req.body.reason || "").trim(); if (!validId(req.params.id) || reason.length < 5 || reason.length > 1000) return res.status(400).json({ message: "A cancellation reason of 5–1000 characters is required" }); await scheduling.cancel({ appointmentId: req.params.id, actorId: req.user.id, actorRole: "admin", appointmentVersion: req.body.appointmentVersion, reason }); res.json({ message: "Appointment cancelled" }); } catch (error) { next(error); } });

router.get("/analytics", async (_req, res, next) => { try { const [appointmentsByStatus, appointmentsBySpecialty, doctorsBySpecialty, appointmentsOverTime, consultationsOverTime, patientRegistrations, prescriptionCount] = await Promise.all([Appointment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]), Appointment.aggregate([{ $group: { _id: "$specialty", count: { $sum: 1 } } }, { $sort: { count: -1 } }]), User.aggregate([{ $match: { role: "doctor" } }, { $group: { _id: "$specialty", count: { $sum: 1 } } }, { $sort: { count: -1 } }]), Appointment.aggregate([{ $match: { startAt: { $type: "date" } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$startAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]), Consultation.aggregate([{ $match: { status: "completed", completedAt: { $type: "date" } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$completedAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]), User.aggregate([{ $match: { role: "patient" } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]), Prescription.countDocuments()]); res.json({ appointmentsByStatus, appointmentsBySpecialty, doctorsBySpecialty, appointmentsOverTime, consultationsOverTime, patientRegistrations, prescriptionCount }); } catch (error) { next(error); } });
router.get("/audit-logs", async (req, res, next) => { try { const { page, limit } = pageValues(req.query); const filter = {}; if (req.query.action) filter.action = String(req.query.action).slice(0, 100); if (["patient", "doctor", "admin"].includes(req.query.actorRole)) filter.actorRole = req.query.actorRole; if (req.query.targetType) filter.targetType = String(req.query.targetType).slice(0, 100); if (req.query.dateFrom || req.query.dateTo) filter.createdAt = dateRange(req.query); const [logs, total] = await Promise.all([AuditLog.find(filter).populate("actor", "name email role").select("actor actorRole action targetType targetId patient metadata createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]); res.json({ logs, total, page, pages: Math.ceil(total / limit) }); } catch (error) { next(error); } });
router.get("/settings", (req, res) => res.json({ platform: "MediFlow AI", environment: process.env.NODE_ENV === "production" ? "production" : "development", admin: { id: req.user.id, email: req.user.email }, editableServerSettings: false }));

module.exports = router;
