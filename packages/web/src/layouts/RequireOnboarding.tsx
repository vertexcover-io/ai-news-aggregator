import { type ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getOnboarding } from "@/api/onboarding";
import { useSession } from "@/hooks/useSession";

/**
 * Route gate: if the tenant is `pending_setup`, redirect to the onboarding
 * wizard. If `active`, allow access to the child routes (dashboard, etc.).
 * Mounted as a layout wrapper at `/admin`.
 */
export function RequireOnboarding(): ReactElement {
  const { data: session, isLoading: sessionLoading } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding"],
    queryFn: getOnboarding,
    enabled: !sessionLoading && !!session?.authenticated,
  });

  if (sessionLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-mute">Loading...</div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  if (data && data.status === "pending_setup") {
    return <Navigate to="/admin/onboarding" replace />;
  }

  return <Outlet />;
}
