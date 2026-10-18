const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorRole: { type: String, enum: ["patient", "doctor", "admin"], required: true },
  action: { type: String, required: true, maxlength: 100, index: true },
  targetType: { type: String, required: true, maxlength: 100 },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model("AuditLog", auditLogSchema);
