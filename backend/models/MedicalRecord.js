const mongoose = require("mongoose");
const { RECORD_TYPES } = require("../services/medicalFiles");

const medicalRecordSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    doctor: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100,
    },

    recordType: {
      type: String,
      enum: RECORD_TYPES,
      default: "Other",
    },

    fileUrl: {
      type: String,
      default: "",
    },
    storageState: { type: String, enum: ["pending", "ready", "deleting"], default: "ready", index: true },
    fileMimeType: { type: String, default: "" },
    fileSize: { type: Number, min: 0 },
    fileSha256: { type: String, select: false },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "MedicalRecord",
  medicalRecordSchema
);
