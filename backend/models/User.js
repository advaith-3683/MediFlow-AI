const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 15,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: ["patient", "doctor", "admin"],
      default: "patient",
    },

    // Legacy field: email ownership verified by OTP; never an authentication or approval flag.
    isVerified: {
      type: Boolean,
      default: false,
    },
    sessionVersion: { type: Number, default: 0, select: false },
    schedulingVersion: { type: Number, default: 0, select: false },
    otpDeliveryState: { type: String, enum: ["pending", "sent", null], default: null, select: false },

    otp: {
      type: String,
      default: null,
    },

    otpExpiresAt: {
      type: Date,
      default: null,
    },
    accountStatus: { type: String, enum: ["active", "disabled"], default: "active", index: true },
    notificationPreferences: {
      appointmentReminders: { type: Boolean, default: true },
      healthTips: { type: Boolean, default: true },
    },
    isDemo: { type: Boolean, default: false, select: false },

    specialty: { type: String, trim: true, maxlength: 100, default: "" },
    qualifications: { type: [String], default: [] },
    experienceYears: { type: Number, min: 0, max: 80, default: 0 },
    consultationFee: { type: Number, min: 0, default: 0 },
    languages: { type: [String], default: [] },
    bio: { type: String, trim: true, maxlength: 1000, default: "" },
    isDoctorVerified: { type: Boolean, default: false },
    doctorVerificationStatus: { type: String, enum: ["pending", "verified", "rejected"], default: "pending", index: true },
    doctorVerificationReason: { type: String, trim: true, maxlength: 1000, default: "" },
    licenseNumber: { type: String, trim: true, maxlength: 100, default: "" },
    facilityName: { type: String, trim: true, maxlength: 200, default: "" },
    timezone: { type: String, trim: true, default: "Asia/Kolkata" },
    availability: {
      type: [{
        weekday: { type: Number, min: 0, max: 6, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        appointmentDurationMinutes: { type: Number, min: 10, max: 240, default: 30 },
      }],
      default: [],
    },
    unavailableDates: { type: [String], default: [] },
    safetyProfile: {
      allergies: { type: [String], default: [] },
      currentMedications: { type: [String], default: [] },
      conditions: { type: [String], default: [] },
      updatedAt: { type: Date, default: null },
    },

    otpHash: {
      type: String,
      default: null,
      select: false,
    },

    otpPurpose: {
      type: String,
      enum: ["signup", "password-reset", null],
      default: null,
    },

    otpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    otpResendAvailableAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
