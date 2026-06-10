import { useState, type ReactElement, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTenants, impersonateTenant } from "../api/super";
import { useAdminSession } from "../hooks/useAdminSession";
import type { Tenant } from "@newsletter/shared/types";

type StatusFilter = "all" | "active" | "pending_setup";

export function SuperAdminTenantsPage(): ReactElement {
  const queryClient = useQueryClient();
  const sessionQuery = useAdminSession();
  const tenantsQuery = useQuery({
    queryKey: ["super", "tenants"],
    queryFn: listTenants,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const tenantsData = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);

  const filtered = useMemo(() => {
    let result = tenantsData;
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q),
      );
    }
    return result;
  }, [tenantsData, search, statusFilter]);

  const activeCount = tenantsData.filter((t) => t.status === "active").length;
  const pendingCount = tenantsData.filter((t) => t.status === "pending_setup").length;

  async function handleOpen(tenant: Tenant): Promise<void> {
    if (impersonating) return;
    setImpersonating(tenant.id);
    try {
      await impersonateTenant(tenant.id);
      await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
      window.location.assign("/admin");
    } catch {
      setImpersonating(null);
    }
  }

  if (sessionQuery.isLoading || tenantsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading tenants...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-amber-700 mb-1">
            Platform overview
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total tenants" value={tenantsData.length} />
          <StatCard label="Active" value={activeCount} className="stat-active" />
          <StatCard label="In setup" value={pendingCount} className="stat-pending" />
          <StatCard label="Subscribers" value="—" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search tenants by name or slug..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="flex-1 max-w-md border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          />
          <select
            aria-label="Status filter"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white max-w-[160px]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="pending_setup">In setup</option>
          </select>
        </div>

        {/* Tenant table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">Tenant</th>
                <th className="text-left px-4 py-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">Domain</th>
                <th className="text-left px-4 py-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">Subscribers</th>
                <th className="text-left px-4 py-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">Last run</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <TenantAvatar name={tenant.name} slug={tenant.slug} />
                      <div>
                        <p className="font-medium text-sm">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-muted-foreground">
                      {tenant.customDomain ?? "— not set —"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-muted-foreground">—</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-muted-foreground">—</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => { void handleOpen(tenant); }}
                      disabled={impersonating === tenant.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] cursor-pointer"
                      aria-label={`Open ${tenant.name}`}
                    >
                      Open &rarr;
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No tenants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Opening a tenant enters <strong>impersonation</strong> — you&apos;ll see their
          dashboard as-is, with a banner and one-click exit.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number | string;
  className?: string;
}): ReactElement {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${className ?? ""}`}>
      <p className="text-2xl font-serif font-medium">{String(value)}</p>
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </p>
    </div>
  );
}

function TenantAvatar({ name, slug }: { name: string; slug: string }): ReactElement {
  const letter = name.charAt(0).toUpperCase();
  // Deterministic color from slug
  const colors = [
    "bg-amber-800",
    "bg-stone-800",
    "bg-blue-700",
    "bg-emerald-700",
    "bg-red-800",
    "bg-purple-800",
    "bg-cyan-700",
    "bg-pink-700",
  ];
  const hash = slug.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colorClass = colors[hash % colors.length];

  return (
    <div
      className={`w-8 h-8 rounded-lg ${colorClass} flex items-center justify-center text-white text-sm font-mono font-semibold flex-shrink-0`}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isActive ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {status === "active" ? "Active" : "In setup"}
    </span>
  );
}
