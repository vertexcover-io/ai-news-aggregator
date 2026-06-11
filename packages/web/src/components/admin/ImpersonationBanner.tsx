/**
 * Persistent impersonation banner (P6, REQ-102): rendered app-wide in the
 * admin shell while a super_admin session carries a live impersonation
 * cookie (`impersonation` on /api/auth/me). One-click exit clears the
 * cookie server-side (audited, REQ-103) and returns to the super-admin
 * landing. Renders nothing for normal sessions.
 */
import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { exitImpersonation } from "@/api/super";

export function ImpersonationBanner(): ReactElement | null {
  const { data } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [exiting, setExiting] = useState(false);

  const impersonation = data?.impersonation ?? null;
  if (impersonation === null) return null;

  async function handleExit(): Promise<void> {
    setExiting(true);
    try {
      await exitImpersonation();
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await navigate("/admin");
    } finally {
      setExiting(false);
    }
  }

  return (
    <div
      data-testid="impersonation-banner"
      role="status"
      className="sticky top-0 z-40 flex items-center justify-between gap-4 bg-amber-900 px-4 py-2 text-amber-50"
    >
      <span className="font-mono text-xs uppercase tracking-widest">
        You’re viewing <strong>{impersonation.tenant.name}</strong> as super
        admin · changes are audited
      </span>
      <button
        type="button"
        disabled={exiting}
        onClick={() => {
          void handleExit();
        }}
        className="min-h-[44px] shrink-0 font-mono text-xs uppercase tracking-widest underline underline-offset-4 hover:text-white disabled:opacity-60"
      >
        Exit impersonation ✕
      </button>
    </div>
  );
}
