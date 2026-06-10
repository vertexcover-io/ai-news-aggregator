import type { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";

/**
 * Route guard for /admin/super routes.
 *
 * Only super_admin users are allowed through. tenant_admin users are
 * redirected to /admin (which will then route them to their dashboard).
 */
export function RequireSuperAdmin(): ReactElement | null {
  const { data, isLoading } = useAdminSession();

  if (isLoading) return null;

  // Only super_admin can access /admin/super routes
  if (data?.role !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}
