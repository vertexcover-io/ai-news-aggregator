import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "../../hooks/useSession";
import { exitImpersonation } from "../../api/superAdmin";

/**
 * REQ-102: persistent banner while a super admin impersonates a tenant, with
 * a one-click exit. Renders nothing for normal sessions. Mounted in
 * AdminLayout so it shows on every admin page.
 */
export function ImpersonationBanner(): ReactElement | null {
  const { impersonating, tenant } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const exitMutation = useMutation({
    mutationFn: exitImpersonation,
    onSuccess: async () => {
      // Every cached query belongs to the impersonated tenant — drop it all.
      queryClient.clear();
      await navigate("/admin/tenants");
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to exit impersonation",
      );
    },
  });

  if (!impersonating) return null;

  const label = tenant ? `${tenant.name} (${tenant.slug})` : "a tenant";

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span>
        You&rsquo;re viewing <strong>{label}</strong> as super admin · changes
        are audited
      </span>
      <button
        type="button"
        className="shrink-0 rounded border border-amber-400 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 min-h-[36px]"
        disabled={exitMutation.isPending}
        onClick={() => {
          exitMutation.mutate();
        }}
      >
        Exit impersonation ✕
      </button>
    </div>
  );
}
