const Appointment = require("../models/Appointment");

const { SPECIALTIES, normalizeSpecialty } = require("./specialties");
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const clinicOffset = () => {
  const value = process.env.CLINIC_TIMEZONE_OFFSET || "+05:30";
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("CLINIC_TIMEZONE_OFFSET must use +HH:MM or -HH:MM format");
  if (Number(match[3]) > 59 || Number(match[2]) > 14 || (Number(match[2]) === 14 && Number(match[3]) !== 0)) throw new Error("Invalid clinic timezone offset");
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
};

const createStartAt = (date, time) => {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute) - clinicOffset() * 60_000);
  const local = new Date(value.getTime() + clinicOffset() * 60_000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  return value;
};

const localDateKey = (date) => {
  const local = new Date(date.getTime() + clinicOffset() * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
};
const localMinutes = (date) => {
  const local = new Date(date.getTime() + clinicOffset() * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};
const localWeekday = (date) => new Date(date.getTime() + clinicOffset() * 60_000).getUTCDay();
const toMinutes = (time) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };

const availabilityForStart = (doctor, startAt, durationMinutes) => {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime()) || startAt.getUTCSeconds() !== 0 || startAt.getUTCMilliseconds() !== 0) return null;
  const dateKey = localDateKey(startAt);
  if (doctor.unavailableDates?.includes(dateKey)) return null;
  const startMinutes = localMinutes(startAt);
  return doctor.availability?.find((entry) =>
    entry.weekday === localWeekday(startAt) && TIME_PATTERN.test(entry.startTime) && TIME_PATTERN.test(entry.endTime) &&
    durationMinutes === entry.appointmentDurationMinutes && startMinutes >= toMinutes(entry.startTime) && startMinutes + durationMinutes <= toMinutes(entry.endTime) &&
    startMinutes % entry.appointmentDurationMinutes === toMinutes(entry.startTime) % entry.appointmentDurationMinutes
  ) || null;
};

const canonicalStartAt = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)) {
    const error = new Error("Use the exact UTC timestamp returned by the slots API"); error.status = 400; throw error;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) { const error = new Error("Invalid appointment timestamp"); error.status = 400; throw error; }
  return date;
};

const overlaps = (startA, durationA, startB, durationB) =>
  startA < new Date(startB.getTime() + durationB * 60_000) && startB < new Date(startA.getTime() + durationA * 60_000);

const assertOwnership = (appointment, field, userId) => {
  if (!appointment || String(appointment[field]?._id || appointment[field]) !== String(userId)) {
    const error = new Error("Appointment not found"); error.status = 404; throw error;
  }
};

const validateAppointmentSlot = async ({ doctor, patientId, startAt, durationMinutes, excludeAppointmentId }) => {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) { const error = new Error("A valid appointment time is required"); error.status = 400; throw error; }
  if (startAt <= new Date()) { const error = new Error("Appointments must be booked in the future"); error.status = 400; throw error; }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 240) { const error = new Error("Invalid appointment duration"); error.status = 400; throw error; }
  if (!availabilityForStart(doctor, startAt, durationMinutes)) { const error = new Error("The selected time is outside this doctor's availability"); error.status = 400; throw error; }
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const query = {
    status: "scheduled",
    startAt: { $lt: endAt },
    $expr: { $gt: [{ $add: ["$startAt", { $multiply: ["$durationMinutes", 60_000] }] }, startAt] },
  };
  if (excludeAppointmentId) query._id = { $ne: excludeAppointmentId };
  const [doctorCollision, patientCollision] = await Promise.all([
    Appointment.exists({ ...query, doctor: doctor._id }),
    Appointment.exists({ ...query, patient: patientId }),
  ]);
  if (doctorCollision) { const error = new Error("This doctor is already booked during the selected time"); error.status = 409; throw error; }
  if (patientCollision) { const error = new Error("You already have an overlapping appointment"); error.status = 409; throw error; }
};

const legacyStartAt = (appointment) => appointment.startAt || (appointment.appointmentDate && appointment.appointmentTime
  ? createStartAt(appointment.appointmentDate, convertLegacyTime(appointment.appointmentTime)) : null);
const convertLegacyTime = (value) => {
  if (TIME_PATTERN.test(value)) return value;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value || "");
  if (!match) return "";
  let hour = Number(match[1]) % 12; if (match[3].toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
};

module.exports = { SPECIALTIES, normalizeSpecialty, TIME_PATTERN, DATE_PATTERN, createStartAt, localDateKey, localWeekday, availabilityForStart, overlaps, assertOwnership, validateAppointmentSlot, legacyStartAt, canonicalStartAt };
