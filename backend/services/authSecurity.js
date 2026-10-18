const crypto = require("crypto");
const User = require("../models/User");
const { AppError } = require("../middleware/errorHandler");
const { generateOtp, setOtp, safeOtpMatch, OTP_MAX_ATTEMPTS } = require("../utils/otp");
const { assertEmailConfigured, sendOtpEmail } = require("./emailService");

const clearedOtp = { otp: null, otpHash: null, otpPurpose: null, otpExpiresAt: null,
  otpAttempts: 0, otpResendAvailableAt: null, otpDeliveryState: null };
const issueOtp = async (user, purpose) => {
  assertEmailConfigured();
  const otp = generateOtp(); const values = {};
  setOtp(values, purpose, otp); values.otpDeliveryState = "pending";
  const reserved = await User.findOneAndUpdate({ _id: user._id, accountStatus: { $ne: "disabled" },
    ...(purpose === "signup" ? { isVerified: false } : {}), $or: [{ otpResendAvailableAt: null }, { otpResendAvailableAt: { $lte: new Date() } }] },
  { $set: values }, { new: true });
  if (!reserved) throw new AppError(429, "Please wait before requesting another code", "OTP_COOLDOWN");
  const reservation = { _id: user._id, otpHash: values.otpHash, otpDeliveryState: "pending" };
  try {
    const result = await sendOtpEmail({ email: user.email, otp, purpose, deliveryId: crypto.randomUUID() });
    const activated = await User.updateOne(reservation, { $set: { otpDeliveryState: "sent" } });
    if (activated.modifiedCount !== 1) throw new AppError(503, "Code activation failed. Request another code later.", "OTP_ACTIVATION_FAILED");
    return result;
  } catch (error) {
    // Invalidate only this issuance; never clear a concurrently issued code.
    // Keep the cooldown even on ambiguous delivery failures to prevent abuse.
    await User.updateOne(reservation, { $set: { ...clearedOtp, otpResendAvailableAt: values.otpResendAvailableAt } });
    throw error;
  }
};
const consumeOtp = async ({ user, otp, purpose, changes, resetPassword = false }) => {
  if (!user || user.accountStatus === "disabled" || user.otpPurpose !== purpose || user.otpDeliveryState !== "sent" ||
      !user.otpExpiresAt || user.otpExpiresAt <= new Date()) throw new AppError(400, "Invalid or expired code", "INVALID_OTP");
  if (user.otpAttempts >= OTP_MAX_ATTEMPTS) throw new AppError(429, "Too many attempts. Request a new code", "OTP_ATTEMPTS");
  const filter = { _id: user._id, otpHash: user.otpHash, otpPurpose: purpose, otpDeliveryState: "sent",
    accountStatus: { $ne: "disabled" }, ...(purpose === "signup" ? { isVerified: false } : {}),
    otpExpiresAt: { $gt: new Date() }, otpAttempts: { $lt: OTP_MAX_ATTEMPTS } };
  if (!safeOtpMatch(otp, user.otpHash)) {
    await User.updateOne(filter, { $inc: { otpAttempts: 1 } });
    throw new AppError(400, "Invalid or expired code", "INVALID_OTP");
  }
  const updated = await User.findOneAndUpdate(filter, { $set: { ...clearedOtp, ...changes },
    ...(resetPassword ? { $inc: { sessionVersion: 1 } } : {}) }, { new: true, runValidators: true });
  if (!updated) throw new AppError(400, "Invalid or expired code", "INVALID_OTP");
  return updated;
};
module.exports = { issueOtp, consumeOtp };
