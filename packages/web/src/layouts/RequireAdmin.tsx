import type { ReactElement } from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { UnauthenticatedError } from "../api/auth";

export function RequireAdmin(): ReactElement | null {
  const { data, isLoading, error } = useSession();
  const location = useLocation();

  if (isLoading) return null;

  if (error instanceof UnauthenticatedError || !data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
