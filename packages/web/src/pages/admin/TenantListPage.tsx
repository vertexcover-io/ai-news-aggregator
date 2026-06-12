import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  impersonateTenant,
  listTenants,
  type SuperAdminTenant,
} from "../../api/superAdmin";

function StatusBadge({
  status,
}: {
  status: SuperAdminTenant["status"];
}): ReactElement {
  if (status === "active") {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      In setup
    </span>
  );
}

/**
 * REQ-100: super-admin landing page — the tenant list. Opening a tenant
 * starts impersonation (REQ-101); the tenant dashboard then renders as-is.
 */
export function TenantListPage(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const tenantsQuery = useQuery({
    queryKey: ["super-admin", "tenants"],
    queryFn: listTenants,
    refetchOnWindowFocus: false,
  });

  const impersonateMutation = useMutation({
    mutationFn: impersonateTenant,
    onSuccess: async () => {
      // The session now scopes to the impersonated tenant; drop every cache.
      queryClient.clear();
      await navigate("/admin");
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to open tenant",
      );
    },
  });

  const tenants = tenantsQuery.data ?? [];
  const activeCount = tenants.filter((t) => t.status === "active").length;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tenants.length} total · {activeCount} active ·{" "}
          {tenants.length - activeCount} in setup
        </p>
      </div>

      {tenantsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading tenants…</p>
      )}
      {tenantsQuery.isError && (
        <p className="text-sm text-red-600">Failed to load tenants.</p>
      )}

      {!tenantsQuery.isLoading && !tenantsQuery.isError && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{tenant.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                    {tenant.slug}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded border px-3 py-1 font-medium hover:bg-neutral-50 disabled:opacity-50 min-h-[36px]"
                      disabled={impersonateMutation.isPending}
                      onClick={() => {
                        impersonateMutation.mutate(tenant.id);
                      }}
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No tenants yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Opening a tenant enters impersonation — you&rsquo;ll see their
        dashboard as-is, with a banner and one-click exit. Start/stop is
        audited.
      </p>
    </main>
  );
}
