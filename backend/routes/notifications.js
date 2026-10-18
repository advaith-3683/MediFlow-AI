const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { recipientFilter } = require("../services/notificationService");
const router = express.Router();
router.use(authMiddleware);
router.get("/", async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(page) || page < 1 || page > 10000) return res.status(400).json({ message: "Invalid notification pagination" });
    const ownership = recipientFilter(req.user.id);
    const [rows, unreadCount] = await Promise.all([Notification.find(ownership).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(), Notification.countDocuments({ ...ownership, readAt: null })]);
    res.set("Cache-Control", "private, no-store").json({ notifications: rows.slice(0, limit), unreadCount, page, hasMore: rows.length > limit });
  } catch (error) { next(error); }
});
router.get("/preferences", async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("notificationPreferences");
    if (!user) return res.status(404).json({ message: "Account not found" });
    res.json({ appointmentReminders: user.notificationPreferences?.appointmentReminders ?? true, healthTips: user.notificationPreferences?.healthTips ?? true });
  } catch (error) { next(error); }
});
router.patch("/preferences", async (req, res, next) => {
  try {
    const values = req.body;
    if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length || Object.entries(values).some(([key, value]) => !["appointmentReminders", "healthTips"].includes(key) || typeof value !== "boolean")) return res.status(400).json({ message: "Valid notification preferences are required" });
    const update = Object.fromEntries(Object.entries(values).map(([key, value]) => [`notificationPreferences.${key}`, value]));
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true, runValidators: true }).select("notificationPreferences");
    if (!user) return res.status(404).json({ message: "Account not found" });
    res.json({ appointmentReminders: user.notificationPreferences?.appointmentReminders ?? true, healthTips: user.notificationPreferences?.healthTips ?? true });
  } catch (error) { next(error); }
});
router.patch("/read-all", async (req, res, next) => {
  try { await Notification.updateMany({ recipient: req.user.id, readAt: null }, { $set: { readAt: new Date() } }); res.json({ message: "Notifications marked read" }); }
  catch (error) { next(error); }
});
router.patch("/:id/read", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid notification ID" });
    const ownership = { _id: req.params.id, recipient: req.user.id };
    const notification = await Notification.findOneAndUpdate({ ...ownership, readAt: null }, { $set: { readAt: new Date() } }, { new: true }) || await Notification.findOne(ownership);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (error) { next(error); }
});
module.exports = router;
