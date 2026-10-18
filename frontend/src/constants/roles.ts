export const ROLES = [
  {
    id: "patient",
    title: "Patient",
    description: "Book appointments and manage prescriptions",
  },
  {
    id: "doctor",
    title: "Doctor",
    description: "Manage appointments and generate prescriptions",
  },
  {
    id: "admin",
    title: "Admin",
    description: "Hospital administration and queue management",
  },
] as const;

export type UserRole = (typeof ROLES)[number]["id"];