const mongoose = require("mongoose");

const consultationSchema = new mongoose.Schema({
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, unique: true, index: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chiefComplaint: { type: String, trim: true, maxlength: 2000, default: "" },
  symptoms: { type: String, trim: true, maxlength: 4000, default: "" },
  clinicalNotes: { type: String, trim: true, maxlength: 10000, default: "", select: false },
  diagnosis: { type: String, trim: true, maxlength: 4000, default: "" },
  advice: { type: String, trim: true, maxlength: 4000, default: "" },
  followUpInstructions: { type: String, trim: true, maxlength: 4000, default: "" },
  vitals: {
    temperatureC: { type: Number, min: 25, max: 45 },
    pulseBpm: { type: Number, min: 20, max: 250 },
    systolicBp: { type: Number, min: 40, max: 300 },
    diastolicBp: { type: Number, min: 20, max: 200 },
    oxygenSaturation: { type: Number, min: 50, max: 100 },
    weightKg: { type: Number, min: 1, max: 500 },
  },
  status: { type: String, enum: ["draft", "completed"], default: "draft" },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  completionRequestHash: { type: String, select: false },
  completionPrescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription", default: null, select: false },
  completionSafetyWarnings: { type: [new mongoose.Schema({ type: String, message: String }, { _id: false })], default: [], select: false },
  amendments: { type: [{
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  }], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

module.exports = mongoose.model("Consultation", consultationSchema);
