const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const MedicalRecord = require("../models/MedicalRecord");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { MAX_FILE_SIZE, RECORD_TYPES, visibleRecordFilter, createFileStore, sendMedicalFile } = require("../services/medicalFiles");
const { createRecordService } = require("../services/medicalRecords");
const { fileUploadsEnabled } = require("../services/deploymentConfig");
const { AppError } = require("../middleware/errorHandler");
const createMedicalRecordRouter = ({ Model = MedicalRecord, store = createFileStore() } = {}) => {
  const router = express.Router(); const service = createRecordService(Model, store);
  router.use(authMiddleware, authorizeRoles("patient"));
  router.get("/types", (_req, res) => res.json(RECORD_TYPES));
  router.get("/capabilities", (_req, res) => res.json({ fileUploadsEnabled: fileUploadsEnabled(), maxFileSize: MAX_FILE_SIZE }));
  router.get("/my", async (req, res) => {
    try { res.json(await Model.find({ patient: req.user.id, ...visibleRecordFilter() }).sort({ createdAt: -1 })); }
    catch { console.error("Fetch medical records failed"); res.status(500).json({ message: "Unable to fetch medical records" }); }
  });
  const upload = multer({ storage: multer.memoryStorage(), fileFilter(_req, _file, callback) { callback(fileUploadsEnabled() ? null : new AppError(503, "File uploads are disabled on this demo deployment", "MEDICAL_UPLOADS_DISABLED"), fileUploadsEnabled()); }, limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 8, fieldSize: 8192, parts: 10 } });
  const uploadLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, keyGenerator: req => req.user.id, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many record uploads. Please try again later" } });
  router.post("/", uploadLimit, upload.single("file"), async (req, res, next) => {
    try {
      const record = await service.create({ patientId: req.user.id, body: req.body, file: req.file });
      const value = record.toObject ? record.toObject() : { ...record }; delete value.fileSha256;
      res.status(201).json({ message: "Medical record created successfully", record: value });
    } catch (error) { console.error("Create medical record failed"); next(error); }
  });
  router.get("/:id/file", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid medical record ID" });
      const record = await Model.findOne({ _id: req.params.id, patient: req.user.id, ...visibleRecordFilter() }).select("+fileSha256");
      if (!record?.fileUrl) return res.status(404).json({ message: "Medical file not found" });
      await sendMedicalFile(record, req, res, store);
    } catch (error) { next(error); }
  });
  router.delete("/:id", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid medical record ID" });
      await service.remove({ id: req.params.id, patientId: req.user.id });
      res.json({ message: "Medical record deleted successfully" });
    } catch (error) {
      console.error("Delete medical record failed");
      if (error.status) return next(error);
      res.status(503).json({ message: "Deletion could not be confirmed. Cleanup can be retried safely", code: "RECORD_DELETE_PENDING" });
    }
  });
  return router;
};
module.exports = createMedicalRecordRouter();
module.exports.createMedicalRecordRouter = createMedicalRecordRouter;
