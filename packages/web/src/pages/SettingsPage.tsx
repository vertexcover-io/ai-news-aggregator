import { useEffect, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Newspaper } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { putSettings } from "../api/settings";
import { triggerRunNow } from "../api/runs";
import { settingsFormSchema, type SettingsFormValues } from "./settingsSchema";
import { SourcesSection } from "../components/settings/SourcesSection";
import { ScheduleSection } from "../components/settings/ScheduleSection";
import { SaveBar } from "../components/settings/SaveBar";

function getDefaults(): SettingsFormValues {
  return {
    topN: 12,
    halfLifeHours: 24,
    hnConfig: {
      keywords: ["ai", "llm", "agents"],
      pointsThreshold: 100,
      sinceDays: 1,
      count: 50,
      feeds: ["newest", "best"],
      commentsPerItem: 10,
    },
    redditConfig: {
      subreddits: ["MachineLearning", "LocalLLaMA"],
      sort: "hot",
      limit: 25,
      sinceDays: 1,
    },
    webConfig: null,
    scheduleTime: "07:00",
    scheduleTimezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    scheduleEnabled: false,
  };
}

export function SettingsPage(): ReactElement {
  const settingsQuery = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: getDefaults(),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      const { id: _id, updatedAt: _updatedAt, ...rest } = settingsQuery.data;
      void _id;
      void _updatedAt;
      form.reset(rest);
    }
  }, [settingsQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: putSettings,
    onSuccess: async (saved) => {
      toast.success("Settings saved");
      queryClient.setQueryData(["settings"], saved);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    saveMutation.mutate(values);
  });

  async function handleRunNow(): Promise<void> {
    try {
      await triggerRunNow();
      void navigate("/admin");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start run";
      toast.error(message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link to="/admin" className="inline-flex items-center gap-2 font-semibold min-h-[44px]">
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </header>

      <form onSubmit={(e) => { void onSubmit(e); }}>
        <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure your daily newsletter. These settings run every day automatically.
            </p>
          </div>

          <SourcesSection control={form.control} />
          <ScheduleSection
            register={form.register}
            control={form.control}
          />

          <SaveBar
            saving={saveMutation.isPending}
            runNowDisabled={saveMutation.isPending}
            onRunNow={() => {
              void handleRunNow();
            }}
            lastSavedLabel={
              settingsQuery.data ? "All changes saved" : undefined
            }
          />
        </main>
      </form>
    </div>
  );
}
