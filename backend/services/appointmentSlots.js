const { createStartAt, localWeekday, TIME_PATTERN, overlaps, legacyStartAt } = require("./appointmentDomain");

// Used by discovery and slot retrieval so recommendations reflect the same
// recurring hours, blocked dates and actual appointment conflicts as booking.
const slotsForDate = (doctor, date, busy = [], now = new Date()) => {
  const probe = createStartAt(date, "12:00");
  if (!probe || doctor.unavailableDates?.includes(date)) return [];
  const schedule = doctor.availability?.find((entry) => entry.weekday === localWeekday(probe));
  if (!schedule || !TIME_PATTERN.test(schedule.startTime) || !TIME_PATTERN.test(schedule.endTime)) return [];
  const duration = Number(schedule.appointmentDurationMinutes);
  const minutes = (time) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
  if (!Number.isInteger(duration) || duration < 10 || duration > 240 || minutes(schedule.startTime) >= minutes(schedule.endTime)) return [];
  const result = [];
  for (let minute = minutes(schedule.startTime); minute + duration <= minutes(schedule.endTime); minute += duration) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const startAt = createStartAt(date, time);
    if (startAt <= now || busy.some((item) => { const time = legacyStartAt(item); return !time || Number.isNaN(new Date(time).getTime()) || overlaps(startAt, duration, new Date(time), Number(item.durationMinutes) || 30); })) continue;
    result.push({ startAt: startAt.toISOString(), durationMinutes: duration, time });
  }
  return result;
};
module.exports = { slotsForDate };
