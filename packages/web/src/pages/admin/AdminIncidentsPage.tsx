import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import type { Incident, IncidentSeverity, IncidentStatus } from "@newsletter/shared/alerting";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/incidents/SeverityBadge";
import { listIncidents, setIncidentStatus } from "@/api/incidents";

const STATUS_FILTER_OPTIONS: { label: string; value: IncidentStatus | "all" }[] = [
  { label: "Open", value: "open" },
  { label: "Resolved", value: "resolved" },
  { label: "Muted", value: "muted" },
  { label: "All", value: "all" },
];

const SEVERITY_FILTER_OPTIONS: { label: string; value: IncidentSeverity | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Critical", value: "critical" },
  { label: "Error", value: "error" },
  { label: "Warning", value: "warning" },
  { label: "Info", value: "info" },
];

const STATUS_BADGE_STYLES: Record<IncidentStatus, string> = {
  open: "bg-red-50 text-red-700 border-red-200",
  resolved: "bg-green-50 text-green-700 border-green-200",
  muted: "bg-gray-100 text-gray-600 border-gray-200",
};

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${String(diffDay)}d ago`;
}

function IncidentStatusBadge({ status }: { status: IncidentStatus }): ReactElement {
  return (
    <Badge variant="outline" className={STATUS_BADGE_STYLES[status]}>
      {status}
    </Badge>
  );
}

interface IncidentRowProps {
  incident: Incident;
  onResolve: (id: string) => void;
  onMute: (id: string) => void;
  isPending: boolean;
}

function IncidentRow({ incident, onResolve, onMute, isPending }: IncidentRowProps): ReactElement {
  return (
    <TableRow key={incident.id} data-incident-id={incident.id}>
      <TableCell className="px-4 py-3 align-middle">
        <SeverityBadge severity={incident.severity} />
      </TableCell>
      <TableCell className="px-4 py-3 align-middle font-medium">
        {incident.title}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-sm text-muted-foreground">
        {incident.source ?? "—"}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-sm text-center">
        {incident.occurrences}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-sm text-muted-foreground">
        {formatRelativeTime(incident.firstSeenAt)}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-sm text-muted-foreground">
        {formatRelativeTime(incident.lastSeenAt)}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle">
        <IncidentStatusBadge status={incident.status} />
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-sm">
        {incident.runId !== null ? (
          <Link
            to={`/admin/runs/${incident.runId}`}
            className="text-blue-600 hover:underline text-xs font-mono"
          >
            Run ↗
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 align-middle text-right">
        <div className="flex items-center justify-end gap-2">
          {incident.status !== "resolved" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { onResolve(incident.id); }}
              disabled={isPending}
            >
              Resolve
            </Button>
          )}
          {incident.status !== "muted" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onMute(incident.id); }}
              disabled={isPending}
            >
              Mute
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AdminIncidentsPage(): ReactElement {
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("open");
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "all">("all");

  const listQuery = useQuery<Incident[]>({
    queryKey: ["admin", "incidents", statusFilter, severityFilter],
    queryFn: () =>
      listIncidents({
        status: statusFilter === "all" ? undefined : statusFilter,
        severity: severityFilter === "all" ? undefined : severityFilter,
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentStatus }) =>
      setIncidentStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "incidents"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    },
  });

  function handleResolve(id: string): void {
    statusMutation.mutate({ id, status: "resolved" });
  }

  function handleMute(id: string): void {
    statusMutation.mutate({ id, status: "muted" });
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Centralized view of system incidents, alerts, and health events.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status-filter"
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as IncidentStatus | "all"); }}
            className="rounded border px-2 py-1 text-sm"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="severity-filter" className="text-sm font-medium text-muted-foreground">
            Severity
          </label>
          <select
            id="severity-filter"
            aria-label="Severity"
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value as IncidentSeverity | "all"); }}
            className="rounded border px-2 py-1 text-sm"
          >
            {SEVERITY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : listQuery.isError ? (
        <p className="text-sm text-red-600">Failed to load incidents.</p>
      ) : (listQuery.data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No incidents found.{" "}
          {statusFilter !== "all" || severityFilter !== "all" ? (
            <span>Try adjusting the filters.</span>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-3">Severity</TableHead>
                <TableHead className="px-4 py-3">Title</TableHead>
                <TableHead className="px-4 py-3">Source</TableHead>
                <TableHead className="px-4 py-3 text-center">Occurrences</TableHead>
                <TableHead className="px-4 py-3">First seen</TableHead>
                <TableHead className="px-4 py-3">Last seen</TableHead>
                <TableHead className="px-4 py-3">Status</TableHead>
                <TableHead className="px-4 py-3">Run</TableHead>
                <TableHead className="px-4 py-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(listQuery.data ?? []).map((incident) => (
                <IncidentRow
                  key={incident.id}
                  incident={incident}
                  onResolve={handleResolve}
                  onMute={handleMute}
                  isPending={statusMutation.isPending}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
