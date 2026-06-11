import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../hooks/useSession";

/**
 * Onboarding funnel gate (P11, REQ-030/031/035). Sits inside RequireAdmin:
 *
 *   - tenant in `pending_setup` → every /admin/* surface redirects into the
 *     wizard (nothing else is usable until activation)
 *   - tenant `active` → the wizard itself redirects to the dashboard
 *   - super_admin (no tenant) → untouched
 *
 * While the session is loading RequireAdmin has already resolved it (it
 * renders this gate only with data), so `data` is normally present; render
 * nothing during any in-flight refetch to avoid a redirect flicker.
 */
export function RequireOnboarding(): ReactElement | null {
  const { data, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return null;

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
