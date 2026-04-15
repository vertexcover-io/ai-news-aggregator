import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Newspaper, Play, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunList } from "../hooks/useRunList";
import { useSettings } from "../hooks/useSettings";
import { cancelRun, triggerRunNow } from "../api/runs";
import { RunsTable } from "../components/dashboard/RunsTable";
import { ScheduleBanner } from "../components/dashboard/ScheduleBanner";
import { EmptyState } from "../components/dashboard/EmptyState";

export function DashboardPage(): ReactElement {
  const settingsQuery = useSettings();
  const runsQuery = useRunList();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const runs = runsQuery.data ?? [];
  const hasActive = runs.some((r) => r.status === "running");
  const settings = settingsQuery.data;
  const settingsLoaded = settingsQuery.isFetched;

  async function handleRunNow(): Promise<void> {
    setPending(true);
    try {
      await triggerRunNow();
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

  const runNowDisabled = pending || hasActive;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-8 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings">
              <SettingsIcon />
              Settings
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void handleRunNow();
            }}
            disabled={runNowDisabled}
            className="bg-black text-white hover:bg-black/90"
          >
            <Play />
            Run now
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recent runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curate today&apos;s digest or browse past runs.
          </p>
        </div>

        {settings?.scheduleEnabled === true && (
          <ScheduleBanner
            scheduleTime={settings.scheduleTime}
            scheduleTimezone={settings.scheduleTimezone}
          />
        )}

        {settingsLoaded && settings === null ? (
          <EmptyState />
        ) : (
          <RunsTable
            runs={runs}
            onRetry={() => {
              void handleRunNow();
            }}
            retrying={pending}
            onCancel={handleCancel}
          />
        )}

      </main>
    </div>
  );
}
