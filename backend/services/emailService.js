const axios = require("axios");
const { AppError } = require("../middleware/errorHandler");

const assertEmailConfigured = () => {
  if (process.env.EMAIL_PROVIDER !== "resend" || !process.env.RESEND_API_KEY?.trim() ||
      !process.env.EMAIL_FROM?.trim() || /[\r\n]/.test(process.env.EMAIL_FROM)) {
    throw new AppError(503, "Email delivery is not configured. Contact the administrator.", "EMAIL_NOT_CONFIGURED");
  }
};
const sendOtpEmail = async ({ email, otp, purpose, deliveryId }) => {
  assertEmailConfigured();
  try {
    const response = await axios.post("https://api.resend.com/emails", {
      from: process.env.EMAIL_FROM, to: [email],
      subject: purpose === "signup" ? "Verify your MediFlow account" : "Reset your MediFlow password",
      text: `Your MediFlow ${purpose === "signup" ? "verification" : "password reset"} code is ${otp}. It expires in 5 minutes and can be used once. If you did not request this, ignore this email.`,
    }, { timeout: 10000, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Idempotency-Key": deliveryId } });
    if (!response.data?.id) throw new Error("Missing acceptance receipt");
    // Provider acceptance is not proof of inbox delivery. Never log Axios errors:
    // their request config contains the API key and email body.
    return { delivery: "provider-accepted" };
  } catch {
    throw new AppError(503, "Email delivery could not be confirmed. Please request a new code later.", "EMAIL_DELIVERY_FAILED");
  }
};
const requireEmailEnabled = (_req, _res, next) => {
  if (process.env.AUTH_EMAIL_ENABLED !== "true") return next(new AppError(503, "Email verification and password recovery are disabled. Contact the administrator.", "EMAIL_FEATURE_DISABLED"));
  next();
};
module.exports = { assertEmailConfigured, sendOtpEmail, requireEmailEnabled };
