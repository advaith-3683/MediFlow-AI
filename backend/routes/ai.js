const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const { cleanInput, generate } = require("../services/aiService");
const { triage } = require("../services/triageService");
const { aiProtection } = require("../middleware/aiProtection");
const { needsEmergencyCare, EMERGENCY_GUIDANCE, SAFETY_INSTRUCTION, validateGuidance } = require("../services/aiSafety");

const router = express.Router();
router.use(authMiddleware, authorizeRoles("patient"));
router.use(...aiProtection);

router.post("/chat", async (req, res, next) => {
  try {
    const message = cleanInput(req.body?.message, "Message");
    const language = ["English", "Hindi", "Telugu"].includes(req.body?.language) ? req.body?.language : "English";
    if (needsEmergencyCare(message)) return res.json({ reply: EMERGENCY_GUIDANCE, aiGenerated: false, guidanceSource: "local-safety-rule", priority: "EMERGENCY", disclaimer: "Safety guidance only; not a diagnosis." });
    const systemInstruction = `${SAFETY_INSTRUCTION} Explain broad possible causes, safe self-care, when to see a clinician, and prevention. Reply in ${language}. Label the response as AI-generated and end with a medical-advice disclaimer.`;
    const reply = `AI-generated educational guidance:\n${validateGuidance(await generate({ prompt: message, systemInstruction }))}\n\nNot a diagnosis or prescription. Consult a qualified healthcare professional.`;
    res.json({ reply, aiGenerated: true, disclaimer: "Educational assistance only; not a diagnosis or substitute for professional medical advice." });
  } catch (error) { next(error); } finally { req.aiRelease?.(); }
});

router.post("/triage", async (req, res, next) => {
  try {
    res.json(await triage({ problem: req.body?.problem, language: req.body?.language, patientId: req.user.id }));
  } catch (error) { next(error); } finally { req.aiRelease?.(); }
});

module.exports = router;
