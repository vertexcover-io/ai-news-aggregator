import { useCallback, useMemo } from "react";
import type { ReactElement } from "react";
import { Loader2, Check, X, Minus } from "lucide-react";
import type { CollectorType, HealthCheckResult } from "@newsletter/shared/types";
import { Button } from "@/components/ui/button";
import { useHealthCheckStatus, useTriggerHealthCheck } from "../../hooks/useHealthCheck";

interface HealthCheckButtonProps {
  collector: CollectorType;
  label: string;
}

function formatSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  return `${String(hr)}h ago`;
}

export function HealthCheckButton({
  collector,
  label,
}: HealthCheckButtonProps): ReactElement {
  const { report } = useHealthCheckStatus();
  const trigger = useTriggerHealthCheck(collector);

  const result: HealthCheckResult | undefined = useMemo(() => {
    return report?.results.find((r) => r.collector === collector);
  }, [report, collector]);

  const isWaiting = trigger.isPending;

  const onClick = useCallback(() => {
    trigger.mutate();
  }, [trigger]);

  return (
    <div className="flex items-center gap-2">
      {isWaiting ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running...
        </span>
      ) : result ? (
        result.status === "healthy" ? (
          <span className="flex items-center gap-1 text-xs text-emerald-700">
            <Check className="h-3 w-3" />
            Healthy{report?.storedAt ? ` — ${formatSince(report.storedAt)}` : ""}
          </span>
        ) : result.status === "failed" ? (
          <span className="flex items-center gap-1 text-xs text-red-700" title={result.error}>
            <X className="h-3 w-3" />
            Failed{result.error ? `: ${result.error}` : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Minus className="h-3 w-3" />
            Skipped{result.reason ? ` — ${result.reason}` : ""}
          </span>
        )
      ) : (
        <span className="text-xs text-muted-foreground">Not checked yet</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={trigger.isPending}
        onClick={onClick}
        aria-label={`Check health of ${label}`}
      >
        {trigger.isPending ? "Checking..." : "Check Health"}
      </Button>
    </div>
  );
}
