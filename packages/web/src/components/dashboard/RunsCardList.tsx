import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { ArrowRight, ExternalLink, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CostButton } from "./CostButton";
import { CostDialog } from "./CostDialog";
import { useTriggerSocialPost } from "@/hooks/useTriggerSocialPost";
import { SocialOverflowMenu } from "./SocialOverflowMenu";
import type { SocialChannel } from "./SocialOverflowMenu";
import {
  type DerivedStatus,
  deriveStatus,
  StatusBadge,
  formatStartedAt,
  formatIssueDate,
  canViewSources,
} from "./run-status";

interface RunsCardListProps {
  runs: RunSummary[];
  onRetry: () => void;
  retrying: boolean;
  onCancel: (runId: string) => Promise<void>;
  onDelete: (runId: string) => Promise<void>;
}

function RunCardActions({
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
  if (derived === "ready-to-review" || derived === "draft") {
    return (
      <Button asChild size="sm" className="min-h-[44px] px-3">
        <Link to={`/admin/review/${run.runId}`}>
          Review
          <ArrowRight />
        </Link>
      </Button>
    );
  }
  if (derived === "reviewed") {
    return (
      <Button asChild variant="ghost" size="sm" className="min-h-[44px] px-3">
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
        className="min-h-[44px] px-3"
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
      <Button variant="destructive" size="sm" disabled className="min-h-[44px] px-3">
        Cancelling…
      </Button>
    );
  }
  return (
    <Button variant="destructive" size="sm" onClick={onCancelClick} className="min-h-[44px] px-3">
      Cancel
    </Button>
  );
}

function showDeleteFor(status: DerivedStatus): boolean {
  return (
    status === "ready-to-review" ||
    status === "draft" ||
    status === "reviewed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

// Sub-component that owns the social mutation (needs hook)
function RunCardFooter({
  run,
  derived,
  onRetry,
  retrying,
  onCancelClick,
  onDeleteClick,
  onCostClick,
}: {
  run: RunSummary;
  derived: DerivedStatus;
  onRetry: () => void;
  retrying: boolean;
  onCancelClick: () => void;
  onDeleteClick: () => void;
  onCostClick: () => void;
}): ReactElement {
  const mutation = useTriggerSocialPost(run.runId);
  const runDate = formatStartedAt(run.startedAt).date;

  function handlePostConfirm(channel: SocialChannel): void {
    mutation.mutate(channel, {
      onError: (err) => {
        toast.error(err.message);
      },
    });
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <CostButton
        costBreakdown={run.costBreakdown}
        onClick={onCostClick}
      />
      <SocialOverflowMenu
        run={run}
        runDate={runDate}
        onPostConfirm={handlePostConfirm}
        isPending={mutation.isPending}
      />
      <Button
        asChild
        variant="outline"
        size="sm"
        className="min-h-[44px] px-3"
      >
        <Link to={`/admin/runs/${run.runId}`}>Details</Link>
      </Button>
      {canViewSources(run) ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="min-h-[44px] px-3"
        >
          <Link to={`/admin/sources/${run.runId}`}>Sources</Link>
        </Button>
      ) : null}
      <RunCardActions
        run={run}
        derived={derived}
        onRetry={onRetry}
        retrying={retrying}
        onCancelClick={onCancelClick}
      />
      {showDeleteFor(derived) ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete newsletter"
          onClick={onDeleteClick}
          className="min-h-[44px] min-w-[44px]"
        >
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

export function RunsCardList({
  runs,
  onRetry,
  retrying,
  onCancel,
  onDelete,
}: RunsCardListProps): ReactElement {
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

      <ul className="space-y-3">
        {runs.map((run) => {
          const derived = deriveStatus(run);
          const { date, time } = formatStartedAt(run.startedAt);
          const publishDate = formatIssueDate(run.issueDate);
          return (
            <li
              key={run.runId}
              data-run-id={run.runId}
              className="rounded-md border border-stone-200 bg-white p-4 min-h-[44px]"
            >
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground font-medium">Status</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={derived} />
                  {run.isDryRun ? (
                    <span
                      className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                      data-testid="dry-run-badge"
                    >
                      Dry run
                    </span>
                  ) : null}
                </span>

                <span className="text-muted-foreground font-medium">Started</span>
                <span>
                  <span className="font-medium">{date}</span>
                  {time ? (
                    <span className="ml-1 text-xs text-muted-foreground">{time}</span>
                  ) : null}
                </span>

                {publishDate ? (
                  <>
                    <span className="text-muted-foreground font-medium">
                      Publish date
                    </span>
                    <span className="font-medium">{publishDate}</span>
                  </>
                ) : null}

                <span className="text-muted-foreground font-medium">Posts</span>
                <span className="text-muted-foreground">
                  {derived === "failed" || derived === "cancelled"
                    ? "—"
                    : `${String(run.itemCount)} posts`}
                </span>

                <span className="text-muted-foreground font-medium">Run ID</span>
                <span className="break-all text-xs text-muted-foreground">
                  {run.runId}
                </span>
              </div>

              <RunCardFooter
                run={run}
                derived={derived}
                onRetry={onRetry}
                retrying={retrying}
                onCancelClick={() => { setConfirmRunId(run.runId); }}
                onDeleteClick={() => { setDeleteRunId(run.runId); }}
                onCostClick={() => { setCostRun(run); }}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
