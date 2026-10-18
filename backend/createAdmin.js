const mongoose = require("mongoose");
const { bootstrapValues, bootstrapAdmin } = require("./services/adminBootstrap");
const run = async () => {
  if (!process.argv.includes("--confirm-bootstrap")) throw new Error("Explicit invocation requires --confirm-bootstrap");
  require("dotenv").config({ quiet: true });
  const values = bootstrapValues(process.env);
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require("./models/User");
    await User.init();
    const result = await bootstrapAdmin(User, values);
    console.log(result.created ? "Administrator created. Email ownership remains unverified." : "Administrator already exists. No records changed.");
  } finally { await mongoose.disconnect(); }
};
if (require.main === module) run().catch(() => {
  console.error("Admin bootstrap failed. Check explicit confirmation, configuration, database access, and existing accounts. No credentials were printed.");
  process.exitCode = 1;
});
module.exports = { run };
