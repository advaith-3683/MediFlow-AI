const crypto = require("node:crypto");
const MedicalRecord = require("../models/MedicalRecord");
const { AppError } = require("../middleware/errorHandler");
const { RECORD_TYPES, validateFile, createFileStore } = require("./medicalFiles");
const { fileUploadsEnabled } = require("./deploymentConfig");
const createRecordService = (Model = MedicalRecord, store = createFileStore()) => {
  const create = async ({ patientId, body, file }) => {
    if (file && !fileUploadsEnabled()) throw new AppError(503, "File uploads are disabled on this demo deployment. You can still save a text record.", "MEDICAL_UPLOADS_DISABLED");
    const text = (key, limit, required = false) => {
      const value = body[key] ?? "";
      if (typeof value !== "string" || value.trim().length > limit || (required && !value.trim())) throw new AppError(400, "Valid record details are required", "INVALID_MEDICAL_RECORD");
      return value.trim();
    };
    const values = { patient: patientId, title: text("title", 200, true), description: text("description", 2000), doctor: text("doctor", 100) };
    const recordType = body.recordType === "Imaging" ? "Scan" : body.recordType || "Other";
    if (!RECORD_TYPES.includes(recordType)) throw new AppError(400, "Choose a supported medical record type", "INVALID_RECORD_TYPE");
    const info = file ? validateFile(file) : null;
    const filename = info ? `${crypto.randomUUID()}.${info.mime === "application/pdf" ? "pdf" : info.mime === "image/png" ? "png" : "jpg"}` : "";
    // Durable pending metadata precedes filesystem writes. Never delete a file
    // on a database error: an acknowledgement may be lost after commit.
    const record = await Model.create({ ...values, recordType, fileUrl: filename ? `/uploads/${filename}` : "", storageState: file ? "pending" : "ready", ...(info ? { fileMimeType: info.mime, fileSize: info.size, fileSha256: info.sha256 } : {}) });
    if (!file) return record;
    try {
      await store.write(record.fileUrl, file.buffer);
      const ready = await Model.findOneAndUpdate({ _id: record._id, patient: patientId, storageState: "pending" }, { $set: { storageState: "ready" } }, { new: true, runValidators: true });
      if (!ready) throw new AppError(503, "Upload completion could not be confirmed. Contact the administrator before retrying", "UPLOAD_PENDING");
      return ready;
    } catch { throw new AppError(503, "Upload completion could not be confirmed. Contact the administrator before retrying", "UPLOAD_PENDING"); }
  };
  const remove = async ({ id, patientId }) => {
    const record = await Model.findOne({ _id: id, patient: patientId });
    if (!record) throw new AppError(404, "Medical record not found");
    if (record.storageState === "pending") throw new AppError(409, "Upload is awaiting recovery. Contact the administrator");
    const deleting = await Model.findOneAndUpdate({ _id: id, patient: patientId, storageState: { $ne: "pending" } }, { $set: { storageState: "deleting" } }, { new: true });
    if (!deleting) throw new AppError(409, "Medical record changed. Reload before retrying");
    if (deleting.fileUrl) await store.remove(deleting.fileUrl);
    await Model.deleteOne({ _id: id, patient: patientId, storageState: "deleting" });
  };
  const reconcile = async ({ apply = false, before = new Date(Date.now() - 3600000) } = {}) => {
    const rows = await Model.find({ storageState: { $in: ["pending", "deleting"] }, createdAt: { $lt: before } }).select("+fileSha256");
    const counts = { pending: 0, deleting: 0, recovered: 0, failed: 0 };
    for (const row of rows) {
      counts[row.storageState] += 1;
      if (!apply) continue;
      try {
        if (row.storageState === "deleting") { await remove({ id: row._id, patientId: row.patient }); }
        else {
          try { await store.read(row); await Model.updateOne({ _id: row._id, storageState: "pending" }, { $set: { storageState: "ready" } }); }
          catch (error) {
            if (error.code !== "MEDICAL_FILE_MISSING" && error.code !== "INVALID_MEDICAL_FILE") throw error;
            if (row.fileUrl) await store.remove(row.fileUrl);
            await Model.deleteOne({ _id: row._id, storageState: "pending" });
          }
        }
        counts.recovered += 1;
      } catch { counts.failed += 1; }
    }
    return counts;
  };
  return { create, remove, reconcile };
};
module.exports = { createRecordService };
