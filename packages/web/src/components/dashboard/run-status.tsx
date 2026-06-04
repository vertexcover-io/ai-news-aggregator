import type { ReactElement } from "react";
import type { RunSummary } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DerivedStatus =
  | "running"
  | "cancelling"
  | "cancelled"
  | "ready-to-review"
  | "reviewed"
  | "failed";

export function deriveStatus(run: RunSummary): DerivedStatus {
  if (run.status === "running") return "running";
  if (run.status === "cancelling") return "cancelling";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "failed") return "failed";
  return run.reviewed ? "reviewed" : "ready-to-review";
}

const STATUS_MAP: Record<DerivedStatus, { label: string; className: string }> = {
  running: {
    label: "Running",
    className: "bg-sky-100 text-sky-700 border-transparent",
  },
  cancelling: {
    label: "Cancelling",
    className: "bg-orange-100 text-orange-700 border-transparent",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-gray-100 text-gray-600 border-transparent",
  },
  "ready-to-review": {
    label: "Ready to review",
    className: "bg-amber-100 text-amber-700 border-transparent",
  },
  reviewed: {
    label: "Reviewed",
    className: "bg-emerald-100 text-emerald-700 border-transparent",
  },
  failed: {
    label: "Failed",
    className: "bg-rose-100 text-rose-700 border-transparent",
  },
};

export function StatusBadge({ status }: { status: DerivedStatus }): ReactElement {
  const { label, className } = STATUS_MAP[status];
  return <Badge className={cn(className, "px-2.5 py-0.5")}>{label}</Badge>;
}

export function formatStartedAt(value: string): { date: string; time: string } {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: value, time: "" };
  return {
    date: d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    time: d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  };
}

export function formatIssueDate(value?: string): string {
  if (value === undefined) return "";
  const iso = value.includes("T") ? value : `${value}T00:00:00Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function canViewSources(run: RunSummary): boolean {
  return run.status === "completed";
}
