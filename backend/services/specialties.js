const SPECIALTIES = Object.freeze(["General Physician", "Cardiologist", "Dermatologist", "Orthopedic", "Neurologist", "ENT", "Gastroenterologist", "Pulmonologist", "Dentist", "Ophthalmologist"]);
const aliases = { cardiology: "Cardiologist", dermatology: "Dermatologist", orthopedics: "Orthopedic", orthopaedics: "Orthopedic", "orthopedic surgeon": "Orthopedic", "orthopaedic surgeon": "Orthopedic", neurology: "Neurologist", otolaryngology: "ENT", gastroenterology: "Gastroenterologist", pulmonology: "Pulmonologist", respiratory: "Pulmonologist", general: "General Physician", "general medicine": "General Physician", "primary care": "General Physician", dentistry: "Dentist", dental: "Dentist", ophthalmology: "Ophthalmologist", "eye specialist": "Ophthalmologist" };
const normalizeSpecialty = (value) => {
  if (typeof value !== "string") return null;
  const input = value.trim().toLowerCase();
  return SPECIALTIES.find((item) => item.toLowerCase() === input) || aliases[input] || null;
};
module.exports = { SPECIALTIES, normalizeSpecialty };
