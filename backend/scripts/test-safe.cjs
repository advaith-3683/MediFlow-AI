// Explicit allowlist: never include the legacy destructive HTTP integration suite.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const files = [
  "scheduling", "secretProtection", "deploymentAuth", "authSecurity",
  "recommendationRoutes", "recommendations", "transactionSafety", "consultationCompletion",
  "doctorClinicalAuthorization", "doctorAppointments", "adminSafety", "appointmentDomain",
  "clinicalDomain", "medicalFiles", "medicalRecordsRoutes", "clinicalHistory", "clinicalHistoryRoutes",
  "aiReliability", "aiProtectionRoutes", "portalCompletion", "portalRoutes", "deploymentReadiness",
].map(name => `tests/${name}.test.js`);
const result = spawnSync(process.execPath, ["--test", ...files], { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
process.exitCode = result.status ?? 1;
