import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listTenants,
  impersonate,
  type SuperAdminTenant,
} from "@/api/super-admin";
import { useImpersonation } from "@/hooks/useImpersonation";

const ACTIVE_STATUS = "active";

function isActive(t: SuperAdminTenant): boolean {
  return t.status === ACTIVE_STATUS;
}

function tenantLabel(t: SuperAdminTenant): string {
  const trimmed = t.name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : t.slug;
}

function statusLabel(t: SuperAdminTenant): string {
  if (isActive(t)) return "Active";
  return "In setup";
}

function relativeTime(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${String(days)}d ago`;
}

function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface StatCardProps {
  value: string;
  label: string;
}

function StatCard({ value, label }: StatCardProps): ReactElement {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function SuperAdminPage(): ReactElement {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "setup">(
    "all",
  );
  const { start } = useImpersonation();

  const tenantsQuery = useQuery({
    queryKey: ["super-admin", "tenants"],
    queryFn: listTenants,
  });

  const impersonateMutation = useMutation({
    mutationFn: (tenant: SuperAdminTenant) => impersonate(tenant.id),
    onSuccess: (_res, tenant) => {
      start({ tenantId: tenant.id, tenantName: tenantLabel(tenant) });
      window.location.assign("/admin");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Impersonation failed");
    },
  });

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);

  const stats = useMemo(() => {
    const active = tenants.filter(isActive).length;
    const subscribers = tenants.reduce((sum, t) => sum + t.subscriberCount, 0);
    return {
      total: tenants.length,
      active,
      setup: tenants.length - active,
      subscribers,
    };
  }, [tenants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter === "active" && !isActive(t)) return false;
      if (statusFilter === "setup" && isActive(t)) return false;
      if (q.length === 0) return true;
      return (
        tenantLabel(t).toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.customDomain ?? "").toLowerCase().includes(q)
      );
    });
  }, [tenants, search, statusFilter]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 font-semibold min-h-[44px]"
        >
          <Newspaper className="size-5" />
          Super admin
        </Link>
        <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
          <Link to="/admin/super-admin/credentials">App credentials</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Platform overview
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Tenants</h1>
        </div>

        <div
          data-testid="super-admin-stats"
          className="grid grid-cols-2 gap-4 md:grid-cols-4"
        >
          <StatCard value={compactCount(stats.total)} label="Total tenants" />
          <StatCard value={compactCount(stats.active)} label="Active" />
          <StatCard value={compactCount(stats.setup)} label="In setup" />
          <StatCard
            value={compactCount(stats.subscribers)}
            label="Subscribers"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            data-testid="super-admin-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search tenants by name, slug, or domain…"
            className="h-11 min-h-[44px] flex-1 rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] sm:max-w-sm"
          />
          <select
            data-testid="super-admin-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "all" | "active" | "setup");
            }}
            className="h-11 min-h-[44px] rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="setup">In setup</option>
          </select>
        </div>

        {tenantsQuery.isError ? (
          <div
            data-testid="super-admin-error"
            className="rounded-lg border bg-white p-6 text-sm text-destructive"
          >
            {tenantsQuery.error instanceof Error
              ? tenantsQuery.error.message
              : "Failed to load tenants"}
          </div>
        ) : tenantsQuery.isLoading ? (
          <div
            data-testid="super-admin-loading"
            className="rounded-lg border bg-white p-6 text-sm text-muted-foreground"
          >
            Loading tenants…
          </div>
        ) : filtered.length === 0 ? (
          <div
            data-testid="super-admin-empty"
            className="rounded-lg border bg-white p-6 text-sm text-muted-foreground"
          >
            No tenants match your filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Subscribers</th>
                  <th className="px-4 py-3">Last run</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    data-testid={`super-admin-row-${t.id}`}
                    className="border-b last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{tenantLabel(t)}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.slug}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {t.customDomain ?? "— not set —"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          isActive(t)
                            ? "text-xs font-medium uppercase tracking-wide text-green-700"
                            : "text-xs font-medium uppercase tracking-wide text-amber-700"
                        }
                      >
                        {statusLabel(t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {t.subscriberCount > 0
                        ? t.subscriberCount.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {relativeTime(t.lastRunAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`super-admin-open-${t.id}`}
                        disabled={impersonateMutation.isPending}
                        onClick={() => {
                          impersonateMutation.mutate(t);
                        }}
                      >
                        Open →
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Opening a tenant enters <strong>impersonation</strong> — you&apos;ll
          see their dashboard as-is, with a banner and one-click exit. Start/stop
          is audited.
        </p>
      </main>
    </div>
  );
}
