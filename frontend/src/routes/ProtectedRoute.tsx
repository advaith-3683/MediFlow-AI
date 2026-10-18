import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/types";

export default function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: UserRole[] }) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center text-slate-600">Restoring your session...</div>;
  if (!isAuthenticated || !user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to={`/${user.role}/dashboard`} replace />;
  if (user.role === "doctor" && user.doctorVerificationStatus !== "verified" && location.pathname !== "/doctor/verification-pending" && location.pathname !== "/notifications") return <Navigate to="/doctor/verification-pending" replace />;
  if (user.role === "doctor" && user.doctorVerificationStatus === "verified" && location.pathname === "/doctor/verification-pending") return <Navigate to="/doctor/dashboard" replace />;
  return <>{children}</>;
}
