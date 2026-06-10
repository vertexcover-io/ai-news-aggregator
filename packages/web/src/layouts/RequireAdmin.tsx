import type { ReactElement } from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { UnauthenticatedError } from "../api/auth";

/**
 * Route guard for /admin routes.
 *
 * - Unauthenticated users → redirected to /admin/login
 * - super_admin users → redirected to /admin/super/tenants (REQ-100)
 *   EXCEPT when already on a /admin/super path (prevents infinite redirect)
 * - tenant_admin users → allowed through
 */
export function RequireAdmin(): ReactElement | null {
  const { data, isLoading, error } = useSession();
  const location = useLocation();

  if (isLoading) return null;

  if (error instanceof UnauthenticatedError || !data?.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin/login?next=${next}`} replace />;
  }

  // REQ-100: super_admin lands on tenant list, not tenant dashboard
  if (data.role === "super_admin" && !location.pathname.startsWith("/admin/super")) {
    return <Navigate to="/admin/super/tenants" replace />;
  }

  return <Outlet />;
}
