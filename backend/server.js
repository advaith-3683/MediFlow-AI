const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { errorHandler } = require("./middleware/errorHandler");

dotenv.config({ quiet: true });

const { deploymentConfig, corsOptions, healthResponse, verifyDatabaseReadiness } = require("./services/deploymentConfig");
let config;
try { config = deploymentConfig(process.env); }
catch { console.error("Invalid deployment configuration. Check required variables and production settings; no values were logged."); process.exit(1); }

const authRoutes = require("./routes/auth");
const aiRoutes = require("./routes/ai");
const appointmentRoutes = require("./routes/appointments");
const medicalRecordsRoutes = require("./routes/medicalRecords");
const doctorAppointmentRoutes = require("./routes/doctorAppointments");
const doctorClinicalRoutes = require("./routes/doctorClinical");
const patientClinicalRoutes = require("./routes/patientClinical");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.set("trust proxy", config.trustProxyHops);
app.use(cors(corsOptions(config.origins)));
app.use(express.json({ limit: "100kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many authentication requests. Please try again later" },
});

[
  "/api/auth/signup",
  "/api/auth/resend-otp",
  "/api/auth/verify-otp",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
].forEach((route) => app.use(route, authLimiter));
app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/medical-records", medicalRecordsRoutes);
app.use("/api/doctor/appointments", doctorAppointmentRoutes);
app.use("/api/doctor/clinical", doctorClinicalRoutes);
app.use("/api/patient", patientClinicalRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (_req, res) => healthResponse(mongoose.connection, res));
app.use((_req, res) => res.status(404).json({ message: "API route not found", code: "ROUTE_NOT_FOUND" }));
app.use(errorHandler);

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    // Do not accept requests before required unique indexes are ready.
    await verifyDatabaseReadiness(mongoose, config.production);
    console.log("MongoDB connected and application indexes initialized");
    return app.listen(config.port, "0.0.0.0", () => console.log("HTTP server started"));
  } catch {
    console.error("Database or index readiness check failed. Server was not started.");
    process.exit(1);
  }
};

if (require.main === module) startServer();

module.exports = { app, startServer };
