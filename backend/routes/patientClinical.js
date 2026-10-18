const express = require("express");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");

const { loadClinicalHistory } = require("../services/clinicalHistory");
const router = express.Router();
router.use(authMiddleware, authorizeRoles("patient"));

router.get("/prescriptions", async (req, res, next) => {
  try {
    res.json((await loadClinicalHistory(req.user.id)).prescriptions);
  } catch (error) { next(error); }
});
router.get("/consultations", async (req, res, next) => {
  try { res.json((await loadClinicalHistory(req.user.id)).consultations); }
  catch (error) { next(error); }
});

router.get("/safety-profile", async (req, res, next) => { try { const user = await User.findById(req.user.id).select("safetyProfile").lean(); res.json({ ...user.safetyProfile, label: "Patient-reported information" }); } catch (error) { next(error); } });
router.patch("/safety-profile", async (req, res, next) => { try {
  const cleanList = (value) => Array.isArray(value) ? [...new Set(value.slice(0, 30).map((item) => String(item).trim()).filter(Boolean))] : [];
  const allergies = cleanList(req.body.allergies); const currentMedications = cleanList(req.body.currentMedications); const conditions = cleanList(req.body.conditions);
  if ([...allergies, ...currentMedications, ...conditions].some((item) => item.length > 200)) return res.status(400).json({ message: "Safety profile entries must be 200 characters or fewer" });
  const safetyProfile = { allergies, currentMedications, conditions, updatedAt: new Date() };
  await User.updateOne({ _id: req.user.id, role: "patient" }, { safetyProfile }); res.json({ message: "Patient-reported safety profile updated", safetyProfile });
} catch (error) { next(error); } });

module.exports = router;
