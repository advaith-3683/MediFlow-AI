const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true, maxlength: 100 },
  title: { type: String, required: true, maxlength: 200 },
  message: { type: String, required: true, maxlength: 1000 },
  link: { type: String, maxlength: 300, default: "" },
  readAt: { type: Date, default: null, index: true },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
module.exports = mongoose.model("Notification", notificationSchema);
