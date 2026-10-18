const mongoose = require("mongoose");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const { runTransaction } = require("./scheduling");
const { AppError } = require("../middleware/errorHandler");
const { assertAccountStatusChange, doctorVerificationUpdate, safeUserView } = require("./adminDomain");
const { SPECIALTIES } = require("./specialties");
const createAdminActions = (dependencies = {}) => {
  const db = { mongoose, User, AuditLog, Notification, ...dependencies };
  const run = async (actorId, operation) => {
    try {
      return await runTransaction(db, async session => {
        const actor = await db.User.findOneAndUpdate({ _id: actorId, role: "admin", accountStatus: { $ne: "disabled" } }, { $inc: { schedulingVersion: 1 } }, { session, new: true });
        if (!actor) throw new AppError(403, "Active administrator access required");
        return operation(session);
      });
    } catch (error) {
      if (error.code === "TRANSACTIONS_REQUIRED") throw new AppError(503, "Administrator changes require MongoDB transaction support", "TRANSACTIONS_REQUIRED");
      if (error.code === "SCHEDULING_OUTCOME_UNKNOWN") throw new AppError(503, "Decision outcome is uncertain. Reload before retrying the identical decision", "ADMIN_OUTCOME_UNKNOWN");
      throw error;
    }
  };
  const event = async (actorId, target, action, metadata, notification, session) => {
    await new db.AuditLog({ actor: actorId, actorRole: "admin", action, targetType: "User", targetId: target._id, patient: target.role === "patient" ? target._id : null, metadata }).save({ session });
    await new db.Notification({ recipient: target._id, ...notification }).save({ session });
  };
  const status = async ({ actorId, targetId, accountStatus }) => {
    assertAccountStatusChange({ actorId, targetId, nextStatus: accountStatus });
    return run(actorId, async session => {
      const target = await db.User.findById(targetId).select("+sessionVersion").session(session);
      if (!target) throw new AppError(404, "User not found");
      if (target.accountStatus === accountStatus) return { message: "Account status is unchanged", user: safeUserView(target) };
      target.accountStatus = accountStatus;
      if (accountStatus === "disabled") target.sessionVersion = (target.sessionVersion || 0) + 1;
      await target.save({ session });
      await event(actorId, target, accountStatus === "disabled" ? "ADMIN_USER_DISABLED" : "ADMIN_USER_REACTIVATED", { newStatus: accountStatus }, { type: "ACCOUNT_STATUS", title: "Account status updated", message: `Your MediFlow account is now ${accountStatus}.`, link: "/notifications" }, session);
      return { message: `Account ${accountStatus}`, user: safeUserView(target) };
    });
  };
  const verification = async ({ actorId, targetId, status: decision, specialty, reason = "" }) => {
    if (typeof reason !== "string" || (decision === "rejected" && (reason.trim().length < 5 || reason.trim().length > 1000))) throw new AppError(400, "A rejection reason of 5-1000 characters is required");
    const nextReason = decision === "rejected" ? reason.trim() : "";
    return run(actorId, async session => {
      const doctor = await db.User.findOne({ _id: targetId, role: "doctor" }).session(session);
      if (!doctor) throw new AppError(404, "Doctor not found");
      const update = { ...doctorVerificationUpdate(decision, specialty ?? doctor.specialty, SPECIALTIES), doctorVerificationReason: nextReason };
      if (Object.entries(update).every(([key, value]) => doctor[key] === value)) return { message: "Doctor decision is unchanged", doctor: safeUserView(doctor) };
      Object.assign(doctor, update); await doctor.save({ session });
      await event(actorId, doctor, decision === "verified" ? "DOCTOR_VERIFIED" : "DOCTOR_REJECTED", { specialty: doctor.specialty, status: decision }, { type: "DOCTOR_VERIFICATION", title: `Doctor profile ${decision}`, message: `Your professional application is now ${decision}. Review your account for details.`, link: decision === "verified" ? "/doctor/profile" : "/doctor/verification-pending" }, session);
      return { message: `Doctor ${decision}`, doctor: safeUserView(doctor) };
    });
  };
  return { status, verification };
};
module.exports = { ...createAdminActions(), createAdminActions };
