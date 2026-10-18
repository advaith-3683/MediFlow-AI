// Explicit offline maintenance only. Never imported by application startup.
const run = async () => {
  if (!process.argv.includes("--confirm-maintenance")) throw new Error("Explicit maintenance confirmation required");
  require("dotenv").config({ quiet: true });
  const mongoose = require("mongoose");
  try {
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
    const { createRecordService } = require("./services/medicalRecords");
    const counts = await createRecordService().reconcile({ apply: process.argv.includes("--apply") });
    console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "read-only", ...counts }));
    if (counts.failed) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
};
if (require.main === module) run().catch(() => { console.error("Medical record maintenance failed. No record details were logged."); process.exitCode = 1; });
module.exports = { run };
