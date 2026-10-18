const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { issueOtp, consumeOtp } = require("../services/authSecurity");
const { assertEmailConfigured, requireEmailEnabled } = require("../services/emailService");
const { SPECIALTIES, normalizeSpecialty } = require("../services/specialties");

const router = express.Router();
router.get("/specialties", (_req, res) => res.json(SPECIALTIES));
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, isVerified: user.isVerified, emailVerified: user.isVerified === true, accountStatus: user.accountStatus, doctorVerificationStatus: user.doctorVerificationStatus === undefined && user.isDoctorVerified ? "verified" : user.doctorVerificationStatus, doctorVerificationReason: user.doctorVerificationReason });
const signToken = (user) => jwt.sign({ userId: user._id.toString(), id: user._id.toString(), role: user.role, isVerified: user.isVerified, sessionVersion: user.sessionVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "7d" });

router.post("/signup", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");
    if (req.body.role && !["patient", "doctor"].includes(req.body.role)) return res.status(400).json({ message: "Choose patient or doctor" });
    const role = req.body.role === "doctor" ? "doctor" : "patient";
    const specialty = role === "doctor" ? normalizeSpecialty(req.body.specialty) : null;
    if (role === "doctor" && !specialty) return res.status(400).json({ message: "Choose a supported doctor specialty" });
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{10,15}$/.test(phone) || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ message: "Enter a valid name, email, phone number, and password of at least 8 characters and at most 72 UTF-8 bytes" });
    }
    if (role === "doctor" && (!Array.isArray(req.body.qualifications) || !req.body.qualifications.some(v => typeof v === "string" && v.trim()) ||
        req.body.qualifications.length > 10 || req.body.qualifications.some(v => typeof v !== "string" || v.length > 200) ||
        !Array.isArray(req.body.languages) || !req.body.languages.some(v => typeof v === "string" && v.trim()) ||
        req.body.languages.length > 10 || req.body.languages.some(v => typeof v !== "string" || v.length > 100) ||
        !Number.isFinite(Number(req.body.experienceYears)) || Number(req.body.experienceYears) < 0 || Number(req.body.experienceYears) > 80 ||
        typeof req.body.bio !== "string" || !req.body.bio.trim() || req.body.bio.length > 1000)) {
      return res.status(400).json({ message: "Valid qualifications, languages, experience, and biography are required for doctor review" });
    }
    let user = await User.findOne({ email });
    if (user) return res.status(409).json({ message: "Email already registered. Please sign in." });
    const passwordHash = await bcrypt.hash(password, 10);
    user = new User({ name, email, phone, password: passwordHash, role, isVerified: false });
    if (role === "doctor") Object.assign(user, { role, specialty, qualifications: Array.isArray(req.body.qualifications) ? req.body.qualifications.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 10) : [], languages: Array.isArray(req.body.languages) ? req.body.languages.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 10) : [], experienceYears: Math.min(Math.max(Number(req.body.experienceYears) || 0, 0), 80), bio: String(req.body.bio || "").trim().slice(0, 1000), licenseNumber: String(req.body.licenseNumber || "").trim().slice(0, 100), facilityName: String(req.body.facilityName || "").trim().slice(0, 200), doctorVerificationStatus: "pending", isDoctorVerified: false });
    await user.save();
    res.json({ message: "Account created", token: signToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post("/resend-otp", requireEmailEnabled, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email, isVerified: false }).select("+otpHash +otpAttempts +otpResendAvailableAt +otpDeliveryState +sessionVersion");
    if (!user) return res.status(400).json({ message: "Unable to resend a verification code" });
    if (user.otpResendAvailableAt && user.otpResendAvailableAt > new Date()) return res.status(429).json({ message: "Please wait before requesting another verification code" });
    const delivery = await issueOtp(user, "signup");
    res.json({ message: "Verification email accepted by provider", ...delivery });
  } catch (error) { next(error); }
});

router.post("/verify-otp", requireEmailEnabled, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "");
    if (!email || !/^\d{6}$/.test(otp)) return res.status(400).json({ message: "Email and a 6-digit code are required" });
    const user = await User.findOne({ email }).select("+otpHash +otpAttempts +otpResendAvailableAt +otpDeliveryState +sessionVersion");
    const verified = await consumeOtp({ user, otp, purpose: "signup", changes: { isVerified: true } });
    res.json({ message: "Account verified successfully", token: signToken(verified), user: publicUser(verified) });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const user = await User.findOne({ email }).select("+sessionVersion");
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: "Invalid email or password" });
    if (user.accountStatus === "disabled") return res.status(403).json({ message: "This account is disabled" });
    res.json({ message: "Login successful", token: signToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
});

router.get("/session", authMiddleware, (req, res) => res.json({ user: publicUser(req.authAccount) }));

router.get("/profile", authMiddleware, authorizeRoles("patient"), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("-password -otp -otpHash -otpPurpose -otpExpiresAt -otpAttempts -otpResendAvailableAt -otpDeliveryState -sessionVersion");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) { next(error); }
});

router.patch("/profile", authMiddleware, authorizeRoles("patient"), async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();
    if (!name || name.length > 100 || !/^\d{10,15}$/.test(phone)) return res.status(400).json({ message: "A valid name and phone number are required" });
    const user = await User.findByIdAndUpdate(req.user.id, { name, phone }, { new: true, runValidators: true }).select("-password -otp -otpHash -otpPurpose -otpExpiresAt -otpAttempts -otpResendAvailableAt -otpDeliveryState -sessionVersion");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated", user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post("/forgot-password", requireEmailEnabled, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email }).select("+otpHash +otpAttempts +otpResendAvailableAt +otpDeliveryState +sessionVersion");
    assertEmailConfigured();
    const generic = { message: "If an eligible account exists, a reset email has been requested" };
    if (!user || user.accountStatus === "disabled" || (user.otpResendAvailableAt && user.otpResendAvailableAt > new Date())) return res.json(generic);
    try { await issueOtp(user, "password-reset"); } catch (error) { if (error.code !== "OTP_COOLDOWN") throw error; }
    res.json(generic);
  } catch (error) { next(error); }
});

router.post("/reset-password", requireEmailEnabled, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "");
    const password = String(req.body.password || "");
    if (!email || !/^\d{6}$/.test(otp) || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ message: "Email, a 6-digit code, and a password of 8+ characters (at most 72 UTF-8 bytes) are required" });
    const user = await User.findOne({ email }).select("+otpHash +otpAttempts +otpResendAvailableAt +otpDeliveryState +sessionVersion");
    const passwordHash = await bcrypt.hash(password, 10);
    await consumeOtp({ user, otp, purpose: "password-reset", changes: { password: passwordHash }, resetPassword: true });
    res.json({ message: "Password reset successfully" });
  } catch (error) { next(error); }
});

module.exports = router;
