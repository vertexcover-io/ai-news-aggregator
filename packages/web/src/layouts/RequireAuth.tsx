import type { ReactElement } from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { UnauthenticatedError } from "../api/auth";
import { useOnboardingRedirectPath } from "../pages/onboarding/useOnboardingRedirect";

export function RequireAuth(): ReactElement | null {
  const { user, isLoading, error } = useSession();
  const location = useLocation();
  const onboardingRedirect = useOnboardingRedirectPath();

  if (isLoading) return null;

  if (error instanceof UnauthenticatedError || !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // REQ-030/031: pending_setup tenants are forced into the wizard.
  if (onboardingRedirect) return <Navigate to={onboardingRedirect} replace />;

  return <Outlet />;
}
