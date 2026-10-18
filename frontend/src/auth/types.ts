export type UserRole = "patient" | "doctor" | "admin";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  /** Email ownership only; authentication does not require verification. */
  isVerified: boolean;
  emailVerified?: boolean;
  doctorVerificationReason?: string;
  doctorVerificationStatus?: "pending" | "verified" | "rejected";
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}
