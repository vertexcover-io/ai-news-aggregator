import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { ArrowRight, ExternalLink, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CostButton } from "./CostButton";
import { CostDialog } from "./CostDialog";
import { useTriggerSocialPost } from "@/hooks/useTriggerSocialPost";
import { SocialOverflowMenu } from "./SocialOverflowMenu";
import type { SocialChannel } from "./SocialOverflowMenu";

interface RunsTableProps {
  runs: RunSummary[];
  onRetry: () => void;
  retrying: boolean;
  onCancel: (runId: string) => Promise<void>;
  onDelete: (runId: string) => Promise<void>;
}

type DerivedStatus =
  | "running"
  | "cancelling"
  | "cancelled"
  | "ready-to-review"
  | "reviewed"
  | "failed";

function deriveStatus(run: RunSummary): DerivedStatus {
  if (run.status === "running") return "running";
  if (run.status === "cancelling") return "cancelling";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "failed") return "failed";
  return run.reviewed ? "reviewed" : "ready-to-review";
}

function StatusBadge({ status }: { status: DerivedStatus }): ReactElement {
  const map: Record<DerivedStatus, { label: string; className: string }> = {
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

function formatIssueDate(value?: string): string {
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

function renderPrimaryAction({
  run,
  derived,
  onRetry,
  retrying,
  onCancelClick,
}: {
  run: RunSummary;
  derived: DerivedStatus;
  onRetry: () => void;
  retrying: boolean;
  onCancelClick: () => void;
}): ReactElement | null {
  if (derived === "ready-to-review") {
    return (
      <Button asChild size="sm">
        <Link to={`/admin/review/${run.runId}`}>
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
  if (derived === "cancelled") {
    return null;
  }
  if (derived === "cancelling") {
    return (
      <Button variant="destructive" size="sm" disabled>
        Cancelling…
      </Button>
    );
  }
  // running
  return (
    <Button variant="destructive" size="sm" onClick={onCancelClick}>
      Cancel
    </Button>
  );
}

function RunActionCell({
  run,
  derived,
  onRetry,
  retrying,
  onCancelClick,
  onDeleteClick,
}: {
  run: RunSummary;
  derived: DerivedStatus;
  onRetry: () => void;
  retrying: boolean;
  onCancelClick: () => void;
  onDeleteClick: (runId: string) => void;
}): ReactElement | null {
  const mutation = useTriggerSocialPost(run.runId);
  const runDate = formatStartedAt(run.startedAt).date;

  function handlePostConfirm(channel: SocialChannel): void {
    mutation.mutate(channel, {
      onError: (err) => {
        toast.error(err.message);
      },
    });
  }

  const primary = renderPrimaryAction({
    run,
    derived,
    onRetry,
    retrying,
    onCancelClick,
  });
  const showDelete =
    derived === "ready-to-review" ||
    derived === "reviewed" ||
    derived === "failed" ||
    derived === "cancelled";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {primary}
      <SocialOverflowMenu
        run={run}
        runDate={runDate}
        onPostConfirm={handlePostConfirm}
        isPending={mutation.isPending}
      />
      {showDelete ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete newsletter"
          onClick={() => {
            onDeleteClick(run.runId);
          }}
        >
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

function canViewSources(run: RunSummary): boolean {
  return run.status === "completed";
}

export function RunsTable({
  runs,
  onRetry,
  retrying,
  onCancel,
  onDelete,
}: RunsTableProps): ReactElement {
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [costRun, setCostRun] = useState<RunSummary | null>(null);

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
        No runs yet
      </div>
    );
  }

  async function handleConfirmCancel(): Promise<void> {
    if (confirmRunId === null) return;
    setCancelling(true);
    try {
      await onCancel(confirmRunId);
    } finally {
      setCancelling(false);
      setConfirmRunId(null);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (deleteRunId === null) return;
    setDeleting(true);
    try {
      await onDelete(deleteRunId);
    } finally {
      setDeleting(false);
      setDeleteRunId(null);
    }
  }

  return (
    <>
      <Dialog
        open={deleteRunId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRunId(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this newsletter?</DialogTitle>
            <DialogDescription>
              This permanently removes the archive and all delivery records.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteRunId(null); }}
              disabled={deleting}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete newsletter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRunId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRunId(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Cancel this run?</DialogTitle>
            <DialogDescription>
              Items already collected will be discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setConfirmRunId(null); }}
              disabled={cancelling}
            >
              Keep running
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmCancel();
              }}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CostDialog
        open={costRun !== null}
        onOpenChange={(open) => {
          if (!open) setCostRun(null);
        }}
        run={costRun}
      />

      <div className="rounded-lg border bg-white [&_[data-slot=table-container]]:overflow-x-visible">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-3 py-3 whitespace-normal">Date</TableHead>
              <TableHead className="px-3 py-3 whitespace-normal">Publish date</TableHead>
              <TableHead className="px-3 py-3 whitespace-normal">Status</TableHead>
              <TableHead className="px-3 py-3 whitespace-normal">Items</TableHead>
              <TableHead className="px-3 py-3 whitespace-normal">Sources</TableHead>
              <TableHead className="px-3 py-3 whitespace-normal">Cost</TableHead>
              <TableHead className="px-3 py-3 text-right whitespace-normal">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const derived = deriveStatus(run);
              const { date, time } = formatStartedAt(run.startedAt);
              const publishDate = formatIssueDate(run.issueDate);
              return (
                <TableRow key={run.runId} data-run-id={run.runId}>
                  <TableCell className="px-3 py-4 align-middle whitespace-normal">
                    <div className="font-medium">{date}</div>
                    <div className="text-xs text-muted-foreground">{time}</div>
                  </TableCell>
                  <TableCell
                    className="px-3 py-4 align-middle font-medium whitespace-normal"
                    data-testid="publish-date-cell"
                  >
                    {publishDate === "" ? "—" : publishDate}
                  </TableCell>
                  <TableCell className="px-3 py-4 align-middle whitespace-normal">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={derived} />
                      {run.isDryRun ? (
                        <span
                          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          data-testid="dry-run-badge"
                        >
                          Dry run
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-4 align-middle text-sm text-muted-foreground whitespace-normal">
                    {derived === "failed" || derived === "cancelled"
                      ? "—"
                      : `${String(run.itemCount)} posts`}
                  </TableCell>
                  <TableCell className="px-3 py-4 align-middle whitespace-normal">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/admin/runs/${run.runId}`}>Details</Link>
                      </Button>
                      {canViewSources(run) ? (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/admin/sources/${run.runId}`}>Sources</Link>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-4 align-middle whitespace-normal">
                    <CostButton
                      costBreakdown={run.costBreakdown}
                      onClick={() => { setCostRun(run); }}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-4 align-middle text-right whitespace-normal">
                    <RunActionCell
                      run={run}
                      derived={derived}
                      onRetry={onRetry}
                      retrying={retrying}
                      onCancelClick={() => { setConfirmRunId(run.runId); }}
                      onDeleteClick={(id) => { setDeleteRunId(id); }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
