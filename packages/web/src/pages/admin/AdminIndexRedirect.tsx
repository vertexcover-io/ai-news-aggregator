import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { DashboardPage } from "@/pages/DashboardPage";

/**
 * REQ-100: a bare super admin landing on /admin goes to the tenant list;
 * tenant admins (and impersonation sessions) get the dashboard.
 */
export function AdminIndexRedirect(): ReactElement {
  const { role, impersonating } = useSession();
  if (role === "super_admin" && !impersonating) {
    return <Navigate to="/admin/tenants" replace />;
  }
  return <DashboardPage />;
}
