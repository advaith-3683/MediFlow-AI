const rateLimit = require("express-rate-limit");
const { needsEmergencyCare } = require("../services/aiSafety");
// Shared by patient chat/triage and approved doctor assistance. No prompts,
// provider results, or credentials are retained in the guard.
const createAiProtection = ({ limit = 20, windowMs = 15 * 60000 } = {}) => {
  const active = new Set();
  const emergency = req => req.path === "/chat" ? needsEmergencyCare(req.body?.message) : req.path === "/triage" && needsEmergencyCare(req.body?.problem);
  const limiter = rateLimit({ windowMs, limit, keyGenerator: req => req.user.id, skip: emergency, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "AI request limit reached. Please try later or select a specialty manually.", code: "AI_RATE_LIMITED" } });
  const inFlight = (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (emergency(req)) return next();
    const key = req.user.id;
    if (active.has(key)) return res.status(409).json({ message: "An AI request is already in progress. Wait for it to finish before retrying.", code: "AI_REQUEST_IN_PROGRESS" });
    active.add(key);
    // Keep the guard until server work finishes, even if the client disconnects.
    let released = false;
    const release = () => { if (!released) { released = true; active.delete(key); } };
    res.once("finish", release);
    req.aiRelease = release;
    next();
  };
  return [limiter, inFlight];
};
const aiProtection = createAiProtection();
module.exports = { aiProtection, createAiProtection };
