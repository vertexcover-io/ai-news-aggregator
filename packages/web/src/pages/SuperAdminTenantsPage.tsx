/**
 * Super-admin console landing (P15, REQ-100): every tenant with owner,
 * status, subscribers, and last run, plus search/status filtering. "Open →"
 * starts an audited impersonation (P6, REQ-101) and routes into that
 * tenant's dashboard, where the app-wide ImpersonationBanner takes over.
 * Mock: .harness/features/multi-tenant/mocks/super-admin.html.
 */
import { useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import type { TenantStatus } from "@newsletter/shared/types/tenant";
import {
  impersonateTenant,
  listTenants,
  type SuperTenantSummary,
} from "@/api/super";
import { logout } from "@/api/auth";
import { Button } from "@/components/ui/button";

type StatusFilter = "all" | TenantStatus;

function matchesQuery(tenant: SuperTenantSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    tenant.name.toLowerCase().includes(q) ||
    tenant.slug.toLowerCase().includes(q) ||
    (tenant.ownerEmail ?? "").toLowerCase().includes(q)
  );
}

function lastRunLabel(lastRunAt: string | null): string {
  if (lastRunAt === null) return "—";
  return `${formatDistanceToNow(new Date(lastRunAt))} ago`;
}

const STATUS_BADGE: Record<TenantStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pending_setup: { label: "In setup", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

function Stat({ value, label, testId }: { value: string; label: string; testId: string }): ReactElement {
  return (
    <div className="rounded-xl border bg-white px-5 py-4">
      <div data-testid={testId} className="font-serif text-3xl text-neutral-900 leading-none">
        {value}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </div>
    </div>
  );
}

export function SuperAdminTenantsPage(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const tenantsQuery = useQuery({
    queryKey: ["super", "tenants"],
    queryFn: listTenants,
  });

  const openMutation = useMutation({
    mutationFn: (tenantId: string) => impersonateTenant(tenantId),
    onSuccess: async () => {
      // The impersonation cookie is set — refresh the session so the route
      // gates and the banner see the acting tenant, then enter its dashboard.
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await navigate("/admin");
    },
  });

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const visible = tenants.filter(
    (t) =>
      matchesQuery(t, query) &&
      (statusFilter === "all" || t.status === statusFilter),
  );
  const activeCount = tenants.filter((t) => t.status === "active").length;
  const setupCount = tenants.filter((t) => t.status === "pending_setup").length;
  const subscriberTotal = tenants.reduce((sum, t) => sum + t.subscriberCount, 0);

  async function handleSignOut(): Promise<void> {
    await logout();
    // Drop the cached session WITHOUT refetching. invalidateQueries would
    // refetch /api/auth/me — which now 401s — and awaiting that rejection
    // skipped the navigate, stranding the page on this guarded route in a
    // redirect + refetch loop. removeQueries clears it with no request.
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
    await navigate("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2 sm:px-6 md:px-8">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold uppercase tracking-widest text-neutral-900">
            Dispatch
          </span>
          <span className="rounded-md bg-neutral-900 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-white">
            Super admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/platform"
            className="font-mono text-xs text-neutral-500 hover:text-neutral-900 underline underline-offset-2"
          >
            Platform settings
          </Link>
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-widest text-orange-800">
          Platform overview
        </p>
        <h1 className="mb-6 font-serif text-4xl text-neutral-900">Tenants</h1>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat value={String(tenants.length)} label="Total tenants" testId="stat-total" />
          <Stat value={String(activeCount)} label="Active" testId="stat-active" />
          <Stat value={String(setupCount)} label="In setup" testId="stat-setup" />
          <Stat value={subscriberTotal.toLocaleString("en-US")} label="Subscribers" testId="stat-subscribers" />
        </div>

        <div className="mb-4 flex items-center gap-2.5">
          <input
            type="search"
            placeholder="Search tenants by name, slug, or owner email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="h-11 w-full max-w-[340px] rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-2"
          />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
            }}
            className="h-11 max-w-[160px] rounded-md border bg-white px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending_setup">In setup</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-white">
          {tenantsQuery.isError ? (
            <p role="alert" className="px-5 py-6 text-sm text-red-700">
              Couldn’t load tenants. Reload to try again.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                  <th className="px-5 py-3 font-medium">Tenant</th>
                  <th className="px-3 py-3 font-medium">Slug</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Subscribers</th>
                  <th className="px-3 py-3 font-medium">Last run</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((tenant) => {
                  const badge = STATUS_BADGE[tenant.status];
                  return (
                    <tr key={tenant.id} className="border-b last:border-b-0">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-neutral-900">{tenant.name}</div>
                        <div className="text-xs text-neutral-500">
                          {tenant.ownerEmail ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-neutral-500">
                        {tenant.slug}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {tenant.subscriberCount > 0
                          ? tenant.subscriberCount.toLocaleString("en-US")
                          : "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-neutral-500">
                        {lastRunLabel(tenant.lastRunAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-[44px]"
                          disabled={openMutation.isPending}
                          onClick={() => {
                            openMutation.mutate(tenant.id);
                          }}
                        >
                          Open →
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && !tenantsQuery.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-sm text-neutral-500">
                      No tenants match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          Opening a tenant enters <strong>impersonation</strong> — you’ll see
          their dashboard as-is, with a banner and one-click exit. Start/stop
          is audited.
        </p>
      </main>
    </div>
  );
}
