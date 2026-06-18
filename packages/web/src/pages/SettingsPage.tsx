import { useEffect, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Newspaper } from "lucide-react";
import { useSettings } from "../hooks/useSettings";
import { putSettings, SettingsApiError } from "../api/settings";
import { triggerRunNow } from "../api/runs";
import {
  settingsFormSchema,
  normalizeSettingsForSubmit,
  type SettingsFormValues,
  type TwitterFormConfig,
} from "./settingsSchema";
import { firstFieldErrorMessage } from "./settingsErrors";
import type { RunSubmitTwitterConfig } from "@newsletter/shared";

function persistedToFormTwitter(
  c: RunSubmitTwitterConfig | null,
): TwitterFormConfig | null {
  if (c === null) return null;
  return {
    listIds: c.listIds.map((value) => ({ value })),
    users: c.users.map((u) => ({ handle: u.handle, userId: u.userId })),
    maxTweetsPerSource: c.maxTweetsPerSource,
    sinceHours: c.sinceHours,
  };
}
import { SourcesSection } from "../components/settings/SourcesSection";
import { ScheduleSection } from "../components/settings/ScheduleSection";
import { AnalyticsSection } from "../components/settings/AnalyticsSection";
import { RankingPromptSection } from "../components/settings/RankingPromptSection";
import { ShortlistPromptSection } from "../components/settings/ShortlistPromptSection";
import { DEFAULT_SHORTLIST_PROMPT } from "@newsletter/shared/constants";
import { SaveBar } from "../components/settings/SaveBar";
import { SocialCredentialsPanel } from "../components/SocialCredentialsPanel";
import { SitePanel } from "../components/settings/SitePanel";
import { EmailPanel } from "../components/settings/EmailPanel";
import { SendingDomainPanel } from "../components/settings/SendingDomainPanel";
import { BrandingPanel } from "../components/settings/BrandingPanel";
import { NotificationsPanel } from "../components/settings/NotificationsPanel";
import { FeaturesPanel } from "../components/settings/FeaturesPanel";
import { ApifyCredentialPanel } from "../components/settings/ApifyCredentialPanel";
import { useSession } from "../hooks/useSession";

function getDefaults(): SettingsFormValues {
  return {
    topN: 12,
    halfLifeHours: 24,
    hnEnabled: true,
    hnConfig: {
      keywords: ["ai", "llm", "agents"],
      pointsThreshold: 100,
      sinceDays: 1,
      count: 50,
      feeds: ["newest", "best"],
      commentsPerItem: 10,
    },
    redditEnabled: true,
    redditConfig: {
      subreddits: ["MachineLearning", "LocalLLaMA"],
      sort: "hot",
      limit: 25,
      sinceDays: 1,
    },
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: "https://us.i.posthog.com",
    pipelineTime: "07:00",
    emailTime: "07:30",
    linkedinTime: "07:45",
    twitterTime: "08:00",
    scheduleTimezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "",
    shortlistPrompt: DEFAULT_SHORTLIST_PROMPT,
    shortlistSize: 30,
  };
}

export function SettingsPage(): ReactElement {
  const settingsQuery = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useSession();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: getDefaults(),
  });

  // Hydrate the form from persisted settings ONCE per fetched server value.
  // Keying on `dataUpdatedAt` instead of `data` avoids a subtle bug where
  // every render produced a new value-equal `data` reference (e.g. from
  // `setQueryData(..., saved)` after the optimistic save), retriggering
  // `form.reset(...)` and wiping in-progress dynamic-array edits the
  // operator hadn't saved yet. (Discovered debugging Stage-5 VS-6:
  // useFieldArray rows added via "Add user" / "Add list" disappeared from
  // form state on the next render even though they remained in the DOM.)
   
  useEffect(() => {
    if (settingsQuery.data) {
      const { id: _id, updatedAt: _updatedAt, ...rest } = settingsQuery.data;
      void _id;
      void _updatedAt;
      form.reset({
        ...rest,
        twitterConfig: persistedToFormTwitter(rest.twitterConfig),
      });
    }
  }, [settingsQuery.dataUpdatedAt]);

  const saveMutation = useMutation({
    mutationFn: putSettings,
    onSuccess: async (saved) => {
      toast.success("Settings saved");
      queryClient.setQueryData(["settings"], saved);
      const { id: _id, updatedAt: _updatedAt, ...rest } = saved;
      void _id;
      void _updatedAt;
      form.reset({
        ...rest,
        twitterConfig: persistedToFormTwitter(rest.twitterConfig),
      });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: unknown) => {
      if (err instanceof SettingsApiError) {
        if (err.status === 422 && err.failures.length > 0) {
          for (const f of err.failures) {
            toast.error(`Failed to resolve @${f.handle}: ${f.reason}`);
          }
          return;
        }
        if (err.status === 400 && err.fields.length > 0) {
          err.fields.forEach((field) => {
            form.setError(field as keyof SettingsFormValues, {
              type: "server",
              message: "must differ from pipelineTime",
            });
          });
        }
        toast.error(err.message);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      saveMutation.mutate(normalizeSettingsForSubmit(values));
    },
    (errors) => {
      // Surface validation errors as a toast so a Save click never silently
      // no-ops. (Discovered by Stage-5 VS-6: zodResolver had silently
      // rejected and react-hook-form's default behaviour swallowed the
      // failure, leaving the operator with a green "All changes saved"
      // banner and no clue why nothing persisted.)
      //
      // Walk the whole errors tree for the first field-level message — a
      // top-level read misses nested failures like twitterConfig.listIds[0]
      // .value and degrades to a useless "Please check your inputs."
      const detail = firstFieldErrorMessage(errors) ?? "Please check your inputs.";
      toast.error(`Cannot save: ${detail}`);
    },
  );

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

      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your daily newsletter. These settings run every day automatically.
          </p>
        </div>

        <FormProvider {...form}>
          <form
            id="settings-form"
            className="space-y-6"
            onSubmit={(e) => {
              // Defensive: ALWAYS preventDefault FIRST so a thrown handleSubmit
              // can't escape into a native form POST (which causes a full page
              // reload and the operator sees a fresh form with no error).
              // Discovered debugging Stage-5 VS-6 — submit event fired,
              // defaultPrevented stayed false, browser did a native POST.
              e.preventDefault();
              onSubmit(e).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);

                console.error("settings save threw:", err);
                toast.error(`Save failed: ${msg}`);
              });
            }}
          >
            <SourcesSection
              control={form.control}
              register={form.register}
              setValue={form.setValue}
            />
            <ScheduleSection
              register={form.register}
              control={form.control}
              errors={form.formState.errors}
            />
            <AnalyticsSection
              register={form.register}
              control={form.control}
            />
            {/* REQ-094: the shortlist-size control is hidden from the tenant
                dashboard — the form keeps the persisted value (internal
                default for new tenants) and submits it unchanged. */}
            <ShortlistPromptSection />
            <RankingPromptSection />
          </form>
        </FormProvider>

        {/* Site URL + default sending address, both zero-config (Fix #3). */}
        <SitePanel />

        {/* Brand identity captured at onboarding — view + edit (FIX #1). */}
        <BrandingPanel />

        <SocialCredentialsPanel />

        {/* Email sending mode: managed default / own domain / own SMTP (Fix #3). */}
        <EmailPanel />

        {/* Sending-domain verification (P14, REQ-084/085): the broadcast is
            gated on a verified domain; transactional mail stays on the
            shared platform sender. */}
        <SendingDomainPanel />

        {/* Per-tenant notification channels (P16, REQ-090–092). */}
        <NotificationsPanel />

        {/* Optional feature flags, all off by default (P16, REQ-093). */}
        <FeaturesPanel />

        {/* Apify platform credential — super_admin only (REQ-019). */}
        {session.data?.user.role === "super_admin" ? (
          <ApifyCredentialPanel />
        ) : null}

        <SaveBar
          formId="settings-form"
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
    </div>
  );
}
