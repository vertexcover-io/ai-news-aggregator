import { useAdminSession } from "../../hooks/useAdminSession";

/** Banner shown when a super-admin is impersonating a tenant. Phase 6. */
export function ImpersonationBanner(): React.ReactElement | null {
  const { data: session } = useAdminSession();

  // NOTE: When Phase 6 session payload includes impersonating/actingTenantId,
  // this component renders. For now, it returns null (no impersonation yet).
  const impersonating = (session as Record<string, unknown> | null)?.impersonating as boolean | undefined;
  const tenantName = (session as Record<string, unknown> | null)?.actingTenantName as string | undefined;

  if (!impersonating) return null;

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm font-mono">
      <span className="text-amber-800">
        Viewing as <strong>{tenantName ?? "tenant"}</strong>
      </span>
      {" — "}
      <a
        href="/api/super/impersonate/exit"
        className="underline text-amber-900 hover:text-amber-950"
        onClick={async (e) => {
          e.preventDefault();
          await fetch("/api/super/impersonate/exit", { method: "POST" });
          window.location.href = "/admin/tenants";
        }}
      >
        Exit
      </a>
    </div>
  );
}
