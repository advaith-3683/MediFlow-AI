const bcrypt = require("bcryptjs");
const bootstrapValues = (env) => {
  const email = String(env.ADMIN_EMAIL || env.DEMO_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(env.ADMIN_PASSWORD || env.DEMO_ADMIN_PASSWORD || "");
  const name = String(env.ADMIN_NAME || env.DEMO_ADMIN_NAME || "").trim();
  const phone = String(env.ADMIN_PHONE || "").trim();
  if (!env.MONGO_URI || !/^\S+@\S+\.\S+$/.test(email) || !name || name.length > 100 ||
      !/^\d{10,15}$/.test(phone) || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Configure MONGO_URI, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PHONE and ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes)");
  }
  return { email, password, name, phone };
};
const bootstrapAdmin = async (User, values) => {
  const existing = await User.findOne({ email: values.email });
  if (existing) {
    if (existing.role !== "admin") throw new Error("Admin email belongs to another role; refusing to elevate it");
    return { created: false };
  }
  if (await User.exists({ role: "admin" })) throw new Error("An administrator already exists; use the existing administrator account");
  const password = await bcrypt.hash(values.password, 12);
  await User.create({ email: values.email, name: values.name, phone: values.phone, password,
    role: "admin", accountStatus: "active", isVerified: false });
  return { created: true };
};
module.exports = { bootstrapValues, bootstrapAdmin };
