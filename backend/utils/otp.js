const crypto = require("crypto");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const hashOtp = (otp) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(otp)).digest("hex");

const safeOtpMatch = (otp, expectedHash) => {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashOtp(otp), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const setOtp = (user, purpose, otp) => {
  user.otp = null;
  user.otpHash = hashOtp(otp);
  user.otpPurpose = purpose;
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  user.otpResendAvailableAt = new Date(Date.now() + OTP_COOLDOWN_MS);
};

const clearOtp = (user) => {
  user.otp = null;
  user.otpHash = null;
  user.otpPurpose = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
  user.otpResendAvailableAt = null;
};

module.exports = {
  OTP_MAX_ATTEMPTS,
  generateOtp,
  safeOtpMatch,
  setOtp,
  clearOtp,
};
