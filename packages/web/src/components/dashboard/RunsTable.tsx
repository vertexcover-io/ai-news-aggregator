import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { ArrowRight, ExternalLink, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface RunsTableProps {
  runs: RunSummary[];
  onRetry: () => void;
  retrying: boolean;
}

type DerivedStatus =
  | "running"
  | "ready-to-review"
  | "reviewed"
  | "failed";

function deriveStatus(run: RunSummary): DerivedStatus {
  if (run.status === "running") return "running";
  if (run.status === "failed") return "failed";
  return run.reviewed ? "reviewed" : "ready-to-review";
}

function StatusBadge({ status }: { status: DerivedStatus }): ReactElement {
  const map: Record<DerivedStatus, { label: string; className: string }> = {
    running: {
      label: "Running",
      className: "bg-sky-100 text-sky-700 border-transparent",
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
  const { label, className } = map[status];
  return <Badge className={cn(className, "px-2.5 py-0.5")}>{label}</Badge>;
}

function formatStartedAt(value: string): { date: string; time: string } {
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

function RunActionCell({
  run,
  derived,
  onRetry,
  retrying,
}: {
  run: RunSummary;
  derived: DerivedStatus;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement | null {
  if (derived === "ready-to-review") {
    return (
      <Button asChild size="sm">
        <Link to={`/review/${run.runId}`}>
          Review
          <ArrowRight />
        </Link>
      </Button>
    );
  }
  if (derived === "reviewed") {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to={`/archive/${run.runId}`}>
          View archive
          <ExternalLink />
        </Link>
      </Button>
    );
  }
  if (derived === "failed") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
      >
        <RotateCw />
        Retry
      </Button>
    );
  }
  // running
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={`/archive/${run.runId}`}>Open</Link>
    </Button>
  );
}

export function RunsTable({
  runs,
  onRetry,
  retrying,
}: RunsTableProps): ReactElement {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
        No runs yet
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-6 py-3">Date</TableHead>
            <TableHead className="px-6 py-3">Status</TableHead>
            <TableHead className="px-6 py-3">Items</TableHead>
            <TableHead className="px-6 py-3 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const derived = deriveStatus(run);
            const { date, time } = formatStartedAt(run.startedAt);
            return (
              <TableRow key={run.runId}>
                <TableCell className="px-6 py-4 align-middle">
                  <div className="font-medium">{date}</div>
                  <div className="text-xs text-muted-foreground">{time}</div>
                </TableCell>
                <TableCell className="px-6 py-4 align-middle">
                  <StatusBadge status={derived} />
                </TableCell>
                <TableCell className="px-6 py-4 align-middle text-sm text-muted-foreground">
                  {derived === "failed" ? "—" : `${String(run.itemCount)} posts`}
                </TableCell>
                <TableCell className="px-6 py-4 align-middle text-right">
                  <RunActionCell
                    run={run}
                    derived={derived}
                    onRetry={onRetry}
                    retrying={retrying}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
