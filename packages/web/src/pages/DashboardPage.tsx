import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Newspaper, Play, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunList } from "../hooks/useRunList";
import { useSettings } from "../hooks/useSettings";
import { useDeleteArchive } from "../hooks/useDeleteArchive";
import { cancelRun, triggerRunNow } from "../api/runs";
import { RunsTable } from "../components/dashboard/RunsTable";
import { RunsCardList } from "../components/dashboard/RunsCardList";
import { ScheduleBanner } from "../components/dashboard/ScheduleBanner";
import { EmptyState } from "../components/dashboard/EmptyState";

export function DashboardPage(): ReactElement {
  const settingsQuery = useSettings();
  const runsQuery = useRunList();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteArchive();
  const [pending, setPending] = useState(false);

  const runs = runsQuery.data ?? [];
  const hasActive = runs.some((r) => r.status === "running");
  const settings = settingsQuery.data;
  const settingsLoaded = settingsQuery.isFetched;

  async function handleRunNow(dryRun = false): Promise<void> {
    setPending(true);
    try {
      await triggerRunNow(dryRun ? { dryRun: true } : undefined);
      await queryClient.invalidateQueries({ queryKey: ["runs", { limit: null }] });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start run";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function handleCancel(runId: string): Promise<void> {
    try {
      await cancelRun(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel run";
      toast.error(message);
    }
    await queryClient.invalidateQueries({ queryKey: ["runs", { limit: null }] });
    await queryClient.invalidateQueries({ queryKey: ["run", runId] });
  }

  async function handleDelete(runId: string): Promise<void> {
    await deleteMutation.mutateAsync(runId);
  }

  const runNowDisabled = pending || hasActive;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link to="/admin" className="inline-flex items-center gap-2 font-semibold min-h-[44px]">
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="min-h-[44px]">
            <Link to="/admin/settings">
              <SettingsIcon />
              Settings
            </Link>
          </Button>
          <RunNowSplitButton
            disabled={runNowDisabled}
            onRun={() => {
              void handleRunNow(false);
            }}
            onRunDry={() => {
              void handleRunNow(true);
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recent runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curate today&apos;s digest or browse past runs.
          </p>
        </div>

        {settings?.scheduleEnabled === true && (
          <ScheduleBanner
            scheduleTime={settings.pipelineTime}
            scheduleTimezone={settings.scheduleTimezone}
          />
        )}

        {settingsLoaded && settings === null ? (
          <EmptyState />
        ) : (
          <>
            <div className="hidden sm:block">
              <RunsTable
                runs={runs}
                onRetry={() => {
                  void handleRunNow();
                }}
                retrying={pending}
                onCancel={handleCancel}
                onDelete={handleDelete}
              />
            </div>
            <div className="sm:hidden">
              <RunsCardList
                runs={runs}
                onRetry={() => {
                  void handleRunNow();
                }}
                retrying={pending}
                onCancel={handleCancel}
                onDelete={handleDelete}
              />
            </div>
          </>
        )}

      </main>
    </div>
  );
}

interface RunNowSplitButtonProps {
  disabled: boolean;
  onRun: () => void;
  onRunDry: () => void;
}

function RunNowSplitButton({
  disabled,
  onRun,
  onRunDry,
}: RunNowSplitButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Button
        size="sm"
        onClick={onRun}
        disabled={disabled}
        className="bg-black text-white hover:bg-black/90 min-h-[44px] px-4 rounded-r-none"
      >
        <Play />
        Run now
      </Button>
      <Button
        size="sm"
        type="button"
        aria-label="More run options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); }}
        disabled={disabled}
        className="bg-black text-white hover:bg-black/90 min-h-[44px] px-2 rounded-l-none border-l border-white/20"
      >
        <ChevronDown />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] rounded-md border bg-white shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onRun();
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Run now
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onRunDry();
            }}
            className="block w-full px-3 py-2 text-left text-sm italic text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            Run now (dry run)
          </button>
        </div>
      ) : null}
    </div>
  );
}
