const User = require("../models/User");
const Appointment = require("../models/Appointment");
const { AppError } = require("../middleware/errorHandler");
const { SPECIALTIES, normalizeSpecialty } = require("./specialties");
const { createStartAt, localDateKey } = require("./appointmentDomain");
const { slotsForDate } = require("./appointmentSlots");

const AVAILABILITY_DAYS = 14;
const NO_MATCH_MESSAGE = "No matching verified doctors are currently available.";
const doctorFields = "_id name email specialty qualifications experienceYears consultationFee languages bio timezone availability unavailableDates role isVerified accountStatus doctorVerificationStatus isDoctorVerified isDemo";
const approvedDoctorFilter = () => ({ role: "doctor", accountStatus: "active", isDemo: { $ne: true },
  $or: [{ doctorVerificationStatus: "verified" }, { doctorVerificationStatus: { $exists: false }, isDoctorVerified: true }],
  $nor: [{ email: { $regex: "^demo\\..+@mediflow\\.local$", $options: "i" } }, { bio: { $regex: "^Development-only sample " } }] });
const eligible = (doctor) => doctor.role === "doctor" && doctor.accountStatus === "active" && doctor.isDemo !== true &&
  !/^demo\..+@mediflow\.local$/i.test(doctor.email || "") && !/^Development-only sample /.test(doctor.bio || "") &&
  (doctor.doctorVerificationStatus === "verified" || (doctor.doctorVerificationStatus === undefined && doctor.isDoctorVerified === true));

const findDoctors = async ({ specialties = SPECIALTIES, patientId, now = new Date(), recommended = false }) => {
  const requested = [...new Set(specialties.map(normalizeSpecialty))];
  if (!requested.length || requested.includes(null)) throw new AppError(400, "Choose a supported specialty", "INVALID_SPECIALTY");
  const doctors = (await User.find({ ...approvedDoctorFilter(), specialty: { $in: requested } }).select(doctorFields).lean())
    .filter((doctor) => eligible(doctor) && requested.includes(doctor.specialty));
  if (!doctors.length) return [];
  const dayStart = createStartAt(localDateKey(now), "00:00");
  const endAt = new Date(dayStart.getTime() + AVAILABILITY_DAYS * 86400000);
  const busy = await Appointment.find({ status: "scheduled", $or: [{ doctor: { $in: doctors.map((doctor) => doctor._id) } }, { patient: patientId }],
    $and: [{ $or: [{ startAt: { $gte: new Date(dayStart.getTime() - 240 * 60000), $lt: endAt } }, { startAt: null }] }] }).select("doctor patient startAt durationMinutes appointmentDate appointmentTime").lean();
  const results = [];
  for (const doctor of doctors) {
    const conflicts = busy.filter((item) => String(item.doctor) === String(doctor._id) || String(item.patient) === String(patientId));
    let nextSlot;
    for (let day = 0; day < AVAILABILITY_DAYS && !nextSlot; day += 1) {
      nextSlot = slotsForDate(doctor, localDateKey(new Date(dayStart.getTime() + day * 86400000)), conflicts, now)[0];
    }
    if (!nextSlot) continue;
    // Public attributes come only from the DB; AI never supplies doctor details.
    const { role: _role, email: _email, isVerified: _verified, accountStatus: _status, doctorVerificationStatus: _approval, isDoctorVerified: _legacy, isDemo: _demo, availability: _availability, unavailableDates: _blocked, ...profile } = doctor;
    results.push({ ...profile, isRecommended: recommended, nextAvailableAt: nextSlot.startAt,
      recommendationReason: `${doctor.specialty} matches ${recommended ? "the AI-suggested" : "your selected"} specialty. An eligible slot is available within the next ${AVAILABILITY_DAYS} days.` });
  }
  return results.sort((left, right) => requested.indexOf(left.specialty) - requested.indexOf(right.specialty) ||
    new Date(left.nextAvailableAt) - new Date(right.nextAvailableAt) || left.name.localeCompare(right.name) || String(left._id).localeCompare(String(right._id)));
};
module.exports = { findDoctors, approvedDoctorFilter, AVAILABILITY_DAYS, NO_MATCH_MESSAGE };
