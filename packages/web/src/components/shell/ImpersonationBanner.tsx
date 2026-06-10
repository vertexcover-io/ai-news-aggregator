import type { ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

export interface ImpersonationBannerProps {
  tenantName: string;
}

/**
 * Impersonation banner rendered app-wide when a super_admin is
 * impersonating a tenant (Phase 6, REQ-102).
 *
 * Features:
 * - Amber warning banner fixed at the top of the viewport
 * - Shows tenant name being impersonated
 * - Exit button calls POST /api/super/impersonate/exit then reloads
 * - Accessible: role="alert", keyboard-operable exit button
 */
export function ImpersonationBanner({ tenantName }: ImpersonationBannerProps): ReactElement {
  const queryClient = useQueryClient();

  async function handleExit(): Promise<void> {
    try {
      await apiFetch("/api/super/impersonate/exit", {
        method: "POST",
      });
    } catch {
      // If the API call fails, reload anyway — the impersonation
      // cookie will be cleared by the browser on reload.
    } finally {
      // Invalidate the session query so RequireAdmin re-checks auth
      await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
      window.location.reload();
    }
  }

  return (
    <div
      role="alert"
      className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between text-sm font-medium"
    >
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clipRule="evenodd"
          />
        </svg>
        <span>
          You are impersonating <strong>{tenantName}</strong>
        </span>
      </div>
      <button
        type="button"
        onClick={() => { void handleExit(); }}
        className="ml-4 px-3 py-1 bg-amber-800 hover:bg-amber-900 rounded text-xs uppercase tracking-wider transition-colors min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
      >
        Exit impersonation
      </button>
    </div>
  );
}
