import type { ReactElement } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { useSession } from "@/hooks/useSession";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";

const NAV_LINK_CLASS =
  "font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center";

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role, impersonating } = useSession();
  const bareSuperAdmin = role === "super_admin" && !impersonating;
  const features = useTenantFeatures();

  async function handleSignOut(): Promise<void> {
    await logout();
    await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    await navigate("/login");
  }

  return (
    <div>
      <ImpersonationBanner />
      <header className="flex items-center justify-between px-4 py-2 border-b">
        <nav className="flex items-center gap-4">
          {bareSuperAdmin ? (
            <Link to="/admin/tenants" className={NAV_LINK_CLASS}>Tenants</Link>
          ) : (
            <>
              <Link to="/admin" className={NAV_LINK_CLASS}>Dashboard</Link>
              <Link to="/admin/settings" className={NAV_LINK_CLASS}>Settings</Link>
              {features.deliverabilityEnabled && (
                <Link to="/admin/analytics" className={NAV_LINK_CLASS}>Analytics</Link>
              )}
              {features.evalEnabled && (
                <Link to="/admin/eval" className={NAV_LINK_CLASS}>Eval</Link>
              )}
              {features.canonEnabled && (
                <Link to="/admin/must-read" className={NAV_LINK_CLASS}>Canon</Link>
              )}
              <Link to="/" className={NAV_LINK_CLASS}>View site ↗</Link>
            </>
          )}
        </nav>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px]"
          onClick={() => {
            void handleSignOut();
          }}
        >
          Sign out
        </Button>
      </header>
      <Outlet />
    </div>
  );
}
