import { useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsApiError } from "../../api/settings";
import { triggerRunNow } from "../../api/runs";
import { useSession } from "../../hooks/useSession";
import {
  settingsFormSchema,
  normalizeSettingsForSubmit,
  type SettingsFormValues,
  type TwitterFormConfig,
} from "../settingsSchema";
import type { RunSubmitTwitterConfig } from "@newsletter/shared";
import { DEFAULT_SHORTLIST_PROMPT } from "@newsletter/shared/constants";
import { SourcesSection } from "../../components/settings/SourcesSection";
import { ScheduleSection } from "../../components/settings/ScheduleSection";
import { AnalyticsSection } from "../../components/settings/AnalyticsSection";
import { RankingPromptSection } from "../../components/settings/RankingPromptSection";
import { ShortlistPromptSection } from "../../components/settings/ShortlistPromptSection";
import { SaveBar } from "../../components/settings/SaveBar";
import {
  getTenantSettings,
  putTenantSettings,
  type TenantSettings,
  type TenantSettingsSubmit,
} from "./SettingsPageApi";
import {
  BrandingPanel,
  FeaturesPanel,
  NotificationsPanel,
  SendingDomainPanel,
  SettingsPanel,
  SocialPanel,
  type FeaturesValue,
} from "./SettingsPagePanels";

// REQ-094: shortlistSize stays in the form schema as a hidden constant (the
// API ignores it); there is NO ShortlistSizeField in the tenant UI.
const HIDDEN_SHORTLIST_SIZE = 30;

const SECTIONS = [
  { id: "branding", label: "Branding" },
  { id: "sources", label: "Sources" },
  { id: "social", label: "Social" },
  { id: "sending-domain", label: "Sending domain" },
  { id: "notifications", label: "Notifications" },
  { id: "features", label: "Features" },
  { id: "schedule", label: "Schedule" },
  { id: "prompts", label: "Prompts" },
] as const;

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
    scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "",
    shortlistPrompt: DEFAULT_SHORTLIST_PROMPT,
    shortlistSize: HIDDEN_SHORTLIST_SIZE,
  };
}

function toFormValues(data: TenantSettings): SettingsFormValues {
  return {
    topN: data.topN,
    halfLifeHours: data.halfLifeHours,
    hnEnabled: data.hnEnabled,
    hnConfig: data.hnConfig,
    redditEnabled: data.redditEnabled,
    redditConfig: data.redditConfig,
    webEnabled: data.webEnabled,
    webConfig: data.webConfig,
    twitterEnabled: data.twitterEnabled,
    twitterConfig: persistedToFormTwitter(data.twitterConfig),
    webSearchEnabled: data.webSearchEnabled,
    webSearchConfig: data.webSearchConfig,
    posthogEnabled: data.posthogEnabled,
    posthogProjectToken: data.posthogProjectToken,
    posthogHost: data.posthogHost,
    pipelineTime: data.pipelineTime,
    emailTime: data.emailTime,
    linkedinTime: data.linkedinTime,
    twitterTime: data.twitterTime,
    scheduleTimezone: data.scheduleTimezone,
    scheduleEnabled: data.scheduleEnabled,
    emailEnabled: data.emailEnabled,
    linkedinEnabled: data.linkedinEnabled,
    twitterPostEnabled: data.twitterPostEnabled,
    autoReview: data.autoReview,
    rankingPrompt: data.rankingPrompt,
    shortlistPrompt: data.shortlistPrompt,
    shortlistSize: HIDDEN_SHORTLIST_SIZE,
  };
}

export function SettingsPage(): ReactElement {
  // A bare (non-impersonating) super admin has no effective tenant —
  // /api/settings would 500. Gate the query and short-circuit the page.
  const { tenant, role } = useSession();
  const bareSuperAdmin = role === "super_admin" && tenant === null;
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getTenantSettings,
    refetchOnWindowFocus: false,
    enabled: !bareSuperAdmin,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState({
    notificationEmail: "",
    slackWebhookUrl: "",
  });
  const [features, setFeatures] = useState<FeaturesValue>({
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: getDefaults(),
  });

  // Hydrate ONCE per fetched server value (keyed on dataUpdatedAt — see the
  // legacy SettingsPage note about wiping in-progress useFieldArray edits).
  useEffect(() => {
    const data = settingsQuery.data;
    if (data) {
      form.reset(toFormValues(data));
      setNotifications({
        notificationEmail: data.notificationEmail ?? "",
        slackWebhookUrl: "",
      });
      setFeatures({
        canonEnabled: data.canonEnabled,
        deliverabilityEnabled: data.deliverabilityEnabled,
        evalEnabled: data.evalEnabled,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.dataUpdatedAt]);

  const saveMutation = useMutation({
    mutationFn: putTenantSettings,
    onSuccess: async (saved) => {
      toast.success("Settings saved");
      queryClient.setQueryData(["settings"], saved);
      form.reset(toFormValues(saved));
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
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      const { shortlistSize: _ignored, ...normalized } =
        normalizeSettingsForSubmit(values);
      const payload: TenantSettingsSubmit = {
        ...normalized,
        ...features,
        notificationEmail:
          notifications.notificationEmail.trim() === ""
            ? null
            : notifications.notificationEmail.trim(),
        // Empty input = leave the stored (encrypted) webhook untouched.
        ...(notifications.slackWebhookUrl.trim() !== ""
          ? { slackWebhookUrl: notifications.slackWebhookUrl.trim() }
          : {}),
      };
      saveMutation.mutate(payload);
    },
    (errors) => {
      const firstField = Object.keys(errors)[0];
      const firstError = firstField
        ? (errors as Record<string, { message?: string }>)[firstField]
        : undefined;
      toast.error(
        `Cannot save: ${firstError?.message ?? "Please check your inputs."}`,
      );
    },
  );

  async function handleRunNow(): Promise<void> {
    try {
      await triggerRunNow();
      void navigate("/admin");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start run");
    }
  }

  if (bareSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="mx-auto max-w-5xl p-4 sm:p-6 md:p-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Settings are per-tenant. Impersonate a tenant from the tenant list
            to manage its settings.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your newsletter: branding, sources, delivery, and
            optional features.
          </p>
        </div>

        <nav
          aria-label="Settings sections"
          className="flex flex-wrap gap-2 text-sm"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border bg-white px-3 py-1 text-neutral-600 hover:text-neutral-900"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <BrandingPanel />

        <FormProvider {...form}>
          <form
            id="settings-form"
            className="space-y-6"
            onSubmit={(e) => {
              // Defensive preventDefault FIRST — see legacy SettingsPage note.
              e.preventDefault();
              onSubmit(e).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                toast.error(`Save failed: ${msg}`);
              });
            }}
          >
            <section id="sources" className="scroll-mt-20">
              <SourcesSection
                control={form.control}
                register={form.register}
                setValue={form.setValue}
              />
            </section>

            <SocialPanel />
            <SendingDomainPanel />

            <NotificationsPanel
              value={notifications}
              hasSlackWebhook={settingsQuery.data?.hasSlackWebhook ?? false}
              onChange={setNotifications}
            />

            <FeaturesPanel value={features} onChange={setFeatures} />

            <section id="schedule" className="scroll-mt-20 space-y-6">
              <ScheduleSection
                register={form.register}
                control={form.control}
                errors={form.formState.errors}
              />
              <AnalyticsSection register={form.register} control={form.control} />
            </section>

            <SettingsPanel
              id="prompts"
              title="Prompts"
              description="Tune how stories are shortlisted and ranked."
            >
              <ShortlistPromptSection />
              <RankingPromptSection />
            </SettingsPanel>
          </form>
        </FormProvider>

        <SaveBar
          formId="settings-form"
          saving={saveMutation.isPending}
          runNowDisabled={saveMutation.isPending}
          onRunNow={() => {
            void handleRunNow();
          }}
          lastSavedLabel={settingsQuery.data ? "All changes saved" : undefined}
        />
      </main>
    </div>
  );
}
