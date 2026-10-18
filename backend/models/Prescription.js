const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema({
  medicineName: { type: String, required: true, trim: true, maxlength: 200 },
  dosage: { type: String, required: true, trim: true, maxlength: 100 },
  frequency: { type: String, required: true, trim: true, maxlength: 100 },
  duration: { type: String, required: true, trim: true, maxlength: 100 },
  instructions: { type: String, trim: true, maxlength: 500, default: "" },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, unique: true },
  consultation: { type: mongoose.Schema.Types.ObjectId, ref: "Consultation", required: true, unique: true },
  medications: { type: [medicationSchema], validate: [(value) => value.length <= 20, "A prescription can contain at most 20 medications"], default: [] },
  generalInstructions: { type: String, trim: true, maxlength: 4000, default: "" },
  followUpDate: { type: Date, default: null },
  status: { type: String, enum: ["active", "voided"], default: "active", index: true },
  voidReason: { type: String, trim: true, maxlength: 1000, default: "" },
  voidedAt: { type: Date, default: null },
  replacementPrescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription", default: null },
  amendments: { type: [{ text: { type: String, required: true, trim: true, maxlength: 4000 }, author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, createdAt: { type: Date, default: Date.now } }], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("Prescription", prescriptionSchema);
