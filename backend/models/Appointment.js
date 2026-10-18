const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    problem: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    specialty: {
      type: String,
      default: "General Physician",
      maxlength: 100,
    },

    appointmentDate: {
      type: String,
      default: "",
    },

    appointmentTime: {
      type: String,
      default: "",
    },

    startAt: { type: Date, default: null, index: true },
    bookingRequestHash: { type: String, select: false },
    durationMinutes: { type: Number, min: 10, max: 240, default: 30 },

    priority: {
      type: String,
      enum: ["normal", "urgent", "emergency"],
      default: "normal",
    },

    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
    },

    aiSummary: {
      type: String,
      default: "",
      maxlength: 4000,
    },

    doctorNotes: {
      type: String,
      default: "",
      maxlength: 10000,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

appointmentSchema.index(
  { doctor: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { startAt: { $type: "date" }, status: "scheduled" } }
);
appointmentSchema.index(
  { patient: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { startAt: { $type: "date" }, status: "scheduled" } }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
