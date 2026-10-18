const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Appointment = require("./models/Appointment");
const { legacyStartAt } = require("./services/appointmentDomain");

dotenv.config({ quiet: true });
const apply = process.argv.includes("--apply");

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  const legacy = await Appointment.find({ startAt: null, appointmentDate: { $ne: "" } });
  let convertible = 0; let updated = 0;
  for (const appointment of legacy) {
    const startAt = legacyStartAt(appointment);
    if (!startAt) continue;
    convertible += 1;
    if (apply) {
      appointment.startAt = startAt;
      appointment.durationMinutes = appointment.durationMinutes || 30;
      await appointment.save();
      updated += 1;
    }
  }
  console.log(apply ? `Migrated ${updated} legacy appointments.` : `Dry run: ${convertible} legacy appointments can be migrated. Re-run with --apply to update them.`);
  await mongoose.disconnect();
}

migrate().catch(() => { console.error("Appointment migration failed"); process.exit(1); });
