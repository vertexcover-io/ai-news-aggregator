import type { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../hooks/useSession";

/**
 * Super-admin console gate (P15, REQ-100). Sits inside RequireAdmin, so the
 * session is already resolved/authenticated — this guard only checks role:
 * a tenant_admin must never see the platform console, so anyone who isn't a
 * super_admin is bounced to their own dashboard.
 */
export function RequireSuperAdmin(): ReactElement | null {
  const { data, isLoading } = useSession();

  if (isLoading) return null;

  if (data?.user.role !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
}
