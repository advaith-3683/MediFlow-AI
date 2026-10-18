const path = require("node:path");
const { AppError } = require("../middleware/errorHandler");
const invalid = key => { throw new Error(`Invalid deployment configuration: ${key}`); };
const fileUploadsEnabled = (env = process.env) => env.MEDICAL_UPLOADS_ENABLED !== "false";
const deploymentConfig = (env = process.env) => {
  const production = env.NODE_ENV === "production";
  for (const key of ["MONGO_URI", "JWT_SECRET"]) if (!env[key]?.trim()) invalid(key);
  if (!/^mongodb(?:\+srv)?:\/\//.test(env.MONGO_URI)) invalid("MONGO_URI");
  if (production && (Buffer.byteLength(env.JWT_SECRET) < 32 || /^replace-/i.test(env.JWT_SECRET))) invalid("JWT_SECRET");
  const port = env.PORT === undefined ? 5000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid("PORT");
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) invalid("TRUST_PROXY_HOPS");
  if (production && !env.CORS_ORIGIN?.trim()) invalid("CORS_ORIGIN");
  const origins = (env.CORS_ORIGIN || "http://localhost:5173").split(",").map(raw => {
    try {
      const url = new URL(raw.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (production && url.protocol !== "https:")) invalid("CORS_ORIGIN");
      return url.origin;
    } catch { return invalid("CORS_ORIGIN"); }
  });
  if (env.MEDICAL_UPLOADS_ENABLED !== undefined && !["true", "false"].includes(env.MEDICAL_UPLOADS_ENABLED)) invalid("MEDICAL_UPLOADS_ENABLED");
  if (production && fileUploadsEnabled(env) && (!env.UPLOADS_DIRECTORY || !path.isAbsolute(env.UPLOADS_DIRECTORY))) invalid("UPLOADS_DIRECTORY (absolute persistent private volume required, or disable file uploads)");
  return { production, port, origins, trustProxyHops };
};
const corsOptions = origins => ({
  origin(origin, callback) { if (!origin || origins.includes(origin)) return callback(null, true); callback(new AppError(403, "Origin is not allowed", "CORS_ORIGIN_DENIED")); },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"],
});
const healthResponse = (connection, res) => {
  const connected = connection.readyState === 1;
  return res.set("Cache-Control", "no-store").status(connected ? 200 : 503).json({ status: connected ? "ok" : "unavailable", database: connected ? "connected" : "unavailable" });
};
const assertTransactionTopology = hello => {
  if (!(hello?.setName || hello?.msg === "isdbgrid") || hello.logicalSessionTimeoutMinutes == null) throw new Error("MongoDB transaction-capable topology required");
};
const verifyDatabaseReadiness = async (instance, production) => {
  if (production) assertTransactionTopology(await instance.connection.db.admin().command({ hello: 1 }));
  await Promise.all(["User", "Appointment", "Consultation", "Prescription", "MedicalRecord", "AuditLog", "Notification"].map(name => instance.model(name).init()));
};
module.exports = { deploymentConfig, corsOptions, healthResponse, fileUploadsEnabled, assertTransactionTopology, verifyDatabaseReadiness };
