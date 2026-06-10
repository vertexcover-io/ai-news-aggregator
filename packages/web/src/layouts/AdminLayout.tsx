import type { ReactElement } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/api/admin";
import { useAdminSession } from "@/hooks/useAdminSession";
import { Button } from "@/components/ui/button";
import { ImpersonationBanner } from "@/components/shell/ImpersonationBanner";

export function AdminLayout(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useAdminSession();

  async function handleSignOut(): Promise<void> {
    await logout();
    await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
    await navigate("/");
  }

  return (
    <div>
      {session?.impersonating && (
        <ImpersonationBanner tenantName={session.impersonatingTenantName ?? "Tenant"} />
      )}
      <header className="flex items-center justify-between px-4 py-2 border-b">
        <nav className="flex items-center gap-4">
          <Link to="/admin" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">Dashboard</Link>
          <Link to="/admin/settings" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">Settings</Link>
          <Link to="/admin/analytics" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">Analytics</Link>
          <Link to="/admin/eval" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">Eval</Link>
          <Link to="/admin/must-read" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">Canon</Link>
          <Link to="/" className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900 min-h-[44px] inline-flex items-center">View site ↗</Link>
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
