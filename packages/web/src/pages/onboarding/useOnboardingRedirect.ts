import { useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";

/**
 * Forced-wizard rule (REQ-030/031): an authenticated tenant_admin whose tenant
 * is still pending_setup must be on /onboarding — every other authed surface
 * redirects there. Super admins (and impersonation sessions, which carry the
 * super_admin role) are exempt.
 *
 * Call unconditionally at the top of RequireAuth (hooks-safe — it only reads
 * the session query + location) and render
 * `<Navigate to={path} replace />` when it returns a path.
 */
export function useOnboardingRedirectPath(): string | null {
  const { user, tenant, role } = useSession();
  const location = useLocation();
  if (!user || !tenant) return null;
  if (role === "super_admin") return null;
  if (tenant.status !== "pending_setup") return null;
  if (location.pathname.startsWith("/onboarding")) return null;
  return "/onboarding";
}
