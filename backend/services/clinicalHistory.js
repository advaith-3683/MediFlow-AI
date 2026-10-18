const Consultation = require("../models/Consultation");
const Prescription = require("../models/Prescription");
const same = (left, right) => String(left?._id || left) === String(right?._id || right);
const loadClinicalHistory = async patientId => {
  const rows = await Consultation.find({ patient: patientId, status: "completed" }).select("-clinicalNotes -vitals -completionRequestHash -completionPrescription -completionSafetyWarnings")
    .populate("doctor", "name specialty qualifications licenseNumber").populate("appointment", "startAt problem status patient doctor").sort({ completedAt: -1 }).lean();
  const consultations = rows.filter(item => item.doctor && item.appointment?.doctor && same(item.patient, patientId) && item.status === "completed" && item.appointment.status === "completed" && same(item.appointment.patient, patientId) && same(item.appointment.doctor, item.doctor));
  const byId = new Map(consultations.map(item => [String(item._id), item]));
  const prescriptions = byId.size ? (await Prescription.find({ patient: patientId, consultation: { $in: [...byId.keys()] } })
    .populate("doctor", "name specialty qualifications licenseNumber").populate("patient", "name").populate("appointment", "startAt problem").sort({ createdAt: -1 }).lean())
    .filter(item => { const consultation = byId.get(String(item.consultation)); return consultation && ["active", "voided"].includes(item.status) && same(item.patient, patientId) && same(item.doctor, consultation.doctor) && same(item.appointment, consultation.appointment); }) : [];
  const byConsultation = new Map(prescriptions.map(item => [String(item.consultation), item]));
  return { consultations: consultations.map(item => {
    // Defense in depth: private notes never belong in patient/shared history,
    // even if a database adapter accidentally ignores projections.
    const { clinicalNotes: _notes, vitals: _vitals, completionRequestHash: _hash, completionPrescription: _receipt, completionSafetyWarnings: _warnings, ...publicItem } = item;
    return { ...publicItem, prescription: byConsultation.get(String(item._id)) || null };
  }), prescriptions };
};
module.exports = { loadClinicalHistory };
