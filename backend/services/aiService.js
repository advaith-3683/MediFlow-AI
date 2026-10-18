const axios = require("axios");
const { AppError } = require("../middleware/errorHandler");

const AI_TIMEOUT_MS = 15000;
const MAX_AI_INPUT = 4000;
let activeRequests = 0;

const cleanInput = (value, label = "Input", maxLength = MAX_AI_INPUT) => {
  if (typeof value !== "string") throw new AppError(400, `${label} must be text`, "AI_INPUT_INVALID");
  const text = value.trim();
  if (!text) throw new AppError(400, `${label} is required`, "AI_INPUT_REQUIRED");
  if (text.length > maxLength) throw new AppError(400, `${label} must be ${maxLength} characters or fewer`, "AI_INPUT_TOO_LONG");
  // Reject C0 controls deliberately; permit tabs and line endings.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new AppError(400, `${label} contains unsupported control characters`, "AI_INPUT_INVALID");
  return text;
};

const generate = async ({ prompt, json = false, systemInstruction, responseJsonSchema }) => {
  if (activeRequests >= 4) throw new AppError(429, "AI assistance is busy. Please try later.", "AI_BUSY");
  activeRequests += 1;
  try {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000) throw new Error("invalid prompt");
    if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("provider not configured");
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("invalid model configuration");
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.2, ...(json ? { responseMimeType: "application/json", ...(responseJsonSchema ? { responseJsonSchema } : {}) } : {}) } },
      { timeout: AI_TIMEOUT_MS, signal: AbortSignal.timeout(AI_TIMEOUT_MS), maxRedirects: 0, maxContentLength: 256 * 1024, maxBodyLength: 64 * 1024, headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } },
    );
    const candidate = response.data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (response.data?.promptFeedback?.blockReason || candidate?.finishReason !== "STOP" || candidate.safetyRatings?.some(item => item.blocked) || !Array.isArray(parts)) throw new Error("blocked or incomplete response");
    const text = parts.filter(part => !part.thought).map(part => { if (typeof part.text !== "string") throw new Error("unsupported provider part"); return part.text; }).join("");
    if (!text.trim() || text.length > 12000) throw new Error("invalid provider text");
    return text;
  } catch {
    throw new AppError(503, "AI assistance is temporarily unavailable. Please try again later.", "AI_UNAVAILABLE");
  } finally { activeRequests -= 1; }
};

module.exports = { cleanInput, generate, MAX_AI_INPUT };
