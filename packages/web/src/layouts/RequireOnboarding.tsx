import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../hooks/useSession";

/**
 * Onboarding funnel gate (P11, REQ-030/031/035). Sits inside RequireAdmin:
 *
 *   - tenant in `pending_setup` → every /admin/* surface redirects into the
 *     wizard (nothing else is usable until activation)
 *   - tenant `active` → the wizard itself redirects to the dashboard
 *   - super_admin NOT impersonating → sent to the tenant-list console
 *     (P15, REQ-100: a super admin lands on the platform console, never a
 *     tenant dashboard); while impersonating it passes through so the
 *     acting tenant's dashboard renders as-is (REQ-101)
 *
 * While the session is loading RequireAdmin has already resolved it (it
 * renders this gate only with data), so `data` is normally present; render
 * nothing during any in-flight refetch to avoid a redirect flicker.
 */
export function RequireOnboarding(): ReactElement | null {
  const { data, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return null;

  const isIdleSuperAdmin =
    data?.user.role === "super_admin" && (data.impersonation ?? null) === null;
  if (isIdleSuperAdmin) {
    return <Navigate to="/admin/tenants" replace />;
  }

  const status = data?.tenant?.status;
  const onWizard = location.pathname.startsWith("/admin/onboarding");

  if (status === "pending_setup" && !onWizard) {
    return <Navigate to="/admin/onboarding" replace />;
  }
  if (status === "active" && onWizard) {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
}
