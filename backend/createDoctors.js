const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const User = require("./models/User");

dotenv.config({ quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Demo doctor seeding is disabled in production");
const demoPassword = process.env.DEMO_DOCTOR_PASSWORD;
if (!demoPassword || demoPassword.length < 8) throw new Error("Set a local DEMO_DOCTOR_PASSWORD of at least 8 characters before seeding");

const specialties = ["General Physician", "Cardiologist", "Dermatologist", "Orthopedic", "Neurologist", "ENT", "Gastroenterologist", "Pulmonologist"];
const names = ["Ananya Rao", "Arjun Mehta", "Priya Sharma", "Kabir Iyer", "Meera Nair", "Rohan Kapoor", "Nisha Verma", "Vikram Sen"];
const weeklyAvailability = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00", appointmentDurationMinutes: 30 }));

async function createDoctors() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const password = await bcrypt.hash(demoPassword, 10);
    for (let index = 0; index < specialties.length; index += 1) {
      const email = `demo.${specialties[index].toLowerCase().replace(/\s+/g, ".")}@mediflow.local`;
      await User.findOneAndUpdate(
        { email },
        { $set: { name: `Dr. ${names[index]}`, phone: `91000000${String(index + 1).padStart(2, "0")}`, password, role: "doctor", isDemo: true, accountStatus: "active", isVerified: true, isDoctorVerified: true, doctorVerificationStatus: "verified", specialty: specialties[index], qualifications: ["MBBS", "MD"], experienceYears: 6 + index, consultationFee: 600 + index * 100, languages: ["English", "Hindi"], bio: `Development-only sample ${specialties[index]} profile for MediFlow demonstrations.`, timezone: "Asia/Kolkata", availability: weeklyAvailability } },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
      console.log("Prepared development doctor");
    }
    console.log("Development doctor profiles are ready. The password was read from DEMO_DOCTOR_PASSWORD and was not printed.");
  } finally { await mongoose.disconnect(); }
}

createDoctors().catch(() => { console.error("Unable to seed development doctors"); process.exit(1); });
