import type { ReactElement } from "react";
import type { CollectorHealthResult } from "@newsletter/shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CollectorHealthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: CollectorHealthResult | null;
}

function formatRelative(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${String(diffHr)}h ago`;
}

function StatusPill({ result }: { result: CollectorHealthResult }): ReactElement {
  if (result.status === "never") {
    return (
      <span
        data-testid="status-pill"
        className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
      >
        Never checked
      </span>
    );
  }
  if (result.status === "running") {
    return (
      <span
        data-testid="status-pill"
        className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
      >
        <svg
          className="h-3 w-3 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Running
      </span>
    );
  }
  if (result.status === "healthy") {
    return (
      <span
        data-testid="status-pill"
        className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700"
      >
        Healthy
      </span>
    );
  }
  return (
    <span
      data-testid="status-pill"
      className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700"
    >
      Failed
    </span>
  );
}

export function CollectorHealthModal({
  open,
  onOpenChange,
  result,
}: CollectorHealthModalProps): ReactElement | null {
  if (result === null) return null;

  const collectorLabel = result.collector === "blog"
    ? "Web (blog listings)"
    : result.collector === "web_search"
    ? "Web Search"
    : result.collector.charAt(0).toUpperCase() + result.collector.slice(1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {collectorLabel} — Health check
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-24 shrink-0">Status</span>
            <StatusPill result={result} />
          </div>
          {result.status === "failed" && result.reason !== null && (
            <div className="flex items-start gap-2">
              <span className="text-sm text-muted-foreground w-24 shrink-0">Reason</span>
              <span data-testid="failure-reason" className="text-sm text-red-700 break-words">
                {result.reason}
              </span>
            </div>
          )}
          {result.checkedAt !== null && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-24 shrink-0">Checked</span>
              <span data-testid="checked-at" className="text-sm">
                {formatRelative(result.checkedAt)}
              </span>
            </div>
          )}
          {result.durationMs !== null && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground w-24 shrink-0">Duration</span>
              <span data-testid="duration" className="text-sm">
                {result.durationMs < 1000
                  ? `${String(result.durationMs)}ms`
                  : `${(result.durationMs / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}
          {result.detail !== null && (
            <div className="flex items-start gap-2">
              <span className="text-sm text-muted-foreground w-24 shrink-0">Detail</span>
              <span data-testid="detail" className="text-sm text-muted-foreground break-words">
                {result.detail}
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
