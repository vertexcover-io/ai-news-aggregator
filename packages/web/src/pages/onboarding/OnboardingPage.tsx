import { useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateOnboarding,
  generatePrompts,
  getOnboardingState,
  patchOnboardingStep,
  OnboardingIncompleteError,
  SlugTakenError,
  ONBOARDING_STEP_ORDER,
  type OnboardingState,
  type OnboardingStepId,
} from "@/api/onboarding";
import { BrandMark } from "@/components/shell/BrandMark";
import { LivePreview } from "./LivePreview";
import {
  ChannelsStep,
  HomepageStep,
  LogoStep,
  NameStep,
  PromptsStep,
  ScheduleStep,
  SlugStep,
  SourcesStep,
  STEP_TITLES,
  type WizardFormValues,
} from "./steps";

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

const wizardSchema = z.object({
  name: z.string().trim().min(1, "Name your newsletter.").max(80, "Keep it under 80 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, "Lowercase letters, numbers, and hyphens — 3 to 30 characters."),
  headline: z.string().trim().min(1, "Add a headline.").max(200, "Keep it under 200 characters."),
  topicStrip: z.string().trim().min(1, "Add a few topics.").max(300, "Keep it under 300 characters."),
  subtagline: z.string().trim().max(300, "Keep it under 300 characters."),
  description: z.string().trim(),
  rankingPrompt: z.string().trim().min(1, "Generate or paste a ranking prompt."),
  shortlistPrompt: z.string().trim().min(1, "Generate or paste a shortlist prompt."),
  pipelineTime: z.string().regex(HHMM_RE, "Pick a time."),
  emailTime: z.string().regex(HHMM_RE, "Pick a time."),
  timezone: z.string().min(1, "Pick a timezone."),
});

const REQUIRED_TAGS: Record<OnboardingStepId, string> = {
  name: "Required",
  slug: "Required",
  logo: "Optional",
  homepage: "Required",
  prompts: "Required",
  channels: "Optional",
  sources: "Required · ≥1",
  schedule: "Required",
};

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const PENDING_PREFIX = "pending-";

function defaultsFromState(state: OnboardingState): WizardFormValues {
  const realSlug = state.tenant.slug.startsWith(PENDING_PREFIX) ? "" : state.tenant.slug;
  return {
    name: state.tenant.name === "My Newsletter" ? "" : state.tenant.name,
    slug: realSlug,
    headline: state.tenant.headline ?? "",
    topicStrip: state.tenant.topicStrip ?? "",
    subtagline: state.tenant.subtagline ?? "",
    description: state.onboarding.description ?? "",
    rankingPrompt: state.prompts?.rankingPrompt ?? "",
    shortlistPrompt: state.prompts?.shortlistPrompt ?? "",
    pipelineTime: state.schedule?.pipelineTime ?? "06:00",
    emailTime: state.schedule?.emailTime ?? "07:30",
    timezone: state.schedule?.timezone ?? detectTimezone(),
  };
}

export function OnboardingPage(): ReactElement | null {
  const { data: state, isLoading } = useQuery({
    queryKey: ["onboarding", "state"],
    queryFn: getOnboardingState,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (isLoading || !state) return null;
  return <OnboardingWizard state={state} />;
}

function OnboardingWizard({ state }: { state: OnboardingState }): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stepCount = ONBOARDING_STEP_ORDER.length;
  const [stepIndex, setStepIndex] = useState(
    Math.min(Math.max(state.onboarding.furthestStep, 0), stepCount - 1),
  );
  const [currentSlug, setCurrentSlug] = useState(
    state.tenant.slug.startsWith(PENDING_PREFIX) ? "" : state.tenant.slug,
  );
  const [logoVersion, setLogoVersion] = useState(state.tenant.logoVersion);
  const [missing, setMissing] = useState<OnboardingStepId[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = useForm<WizardFormValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: defaultsFromState(state),
    mode: "onTouched",
  });

  const [name, slug, headline, topicStrip, subtagline] = useWatch({
    control: form.control,
    name: ["name", "slug", "headline", "topicStrip", "subtagline"],
  });

  // Re-assert the wizard's title after the embedded HomePage preview (which
  // owns document.title on the real public site) updates it. Parent effects
  // run after child effects in the same commit, so this always wins.
  useEffect(() => {
    document.title = "Set up your newsletter";
  }, [name, slug, headline, topicStrip, subtagline]);

  const patchMutation = useMutation({ mutationFn: patchOnboardingStep });
  const generateMutation = useMutation({
    mutationFn: generatePrompts,
    onSuccess: (prompts) => {
      form.setValue("rankingPrompt", prompts.rankingPrompt, { shouldValidate: true });
      form.setValue("shortlistPrompt", prompts.shortlistPrompt, { shouldValidate: true });
    },
  });
  const activateMutation = useMutation({
    mutationFn: activateOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.invalidateQueries({ queryKey: ["onboarding", "state"] });
      void navigate("/admin");
    },
    onError: (err) => {
      if (err instanceof OnboardingIncompleteError) {
        setMissing(err.missing);
      } else {
        setSaveError("Activation failed. Try again.");
      }
    },
  });

  const go = (index: number): void => {
    setStepIndex(Math.min(Math.max(index, 0), stepCount - 1));
    setSaveError(null);
    window.scrollTo(0, 0);
  };
  const goToStep = (step: OnboardingStepId): void => {
    go(ONBOARDING_STEP_ORDER.indexOf(step));
  };

  const saveAndAdvance = async (
    payload: Parameters<typeof patchOnboardingStep>[0],
  ): Promise<void> => {
    setSaveError(null);
    try {
      await patchMutation.mutateAsync(payload);
      setMissing((prev) => prev.filter((s) => s !== payload.step));
      go(stepIndex + 1);
    } catch (err) {
      if (payload.step === "slug" && err instanceof SlugTakenError) {
        form.setError("slug", { message: "That subdomain was just taken. Pick another." });
        return;
      }
      setSaveError("Couldn’t save this step. Try again.");
    }
  };

  const continueName = async (): Promise<void> => {
    if (!(await form.trigger("name"))) return;
    await saveAndAdvance({ step: "name", data: { name: form.getValues("name").trim() } });
  };
  const continueSlug = async (): Promise<void> => {
    if (!(await form.trigger("slug"))) return;
    const value = form.getValues("slug").trim().toLowerCase();
    await saveAndAdvance({ step: "slug", data: { slug: value } });
    setCurrentSlug(value);
  };
  const continueHomepage = async (): Promise<void> => {
    if (!(await form.trigger(["headline", "topicStrip", "subtagline"]))) return;
    const values = form.getValues();
    await saveAndAdvance({
      step: "homepage",
      data: {
        headline: values.headline.trim(),
        topicStrip: values.topicStrip.trim(),
        subtagline: values.subtagline.trim() === "" ? null : values.subtagline.trim(),
      },
    });
  };
  const continuePrompts = async (): Promise<void> => {
    if (!(await form.trigger(["rankingPrompt", "shortlistPrompt"]))) return;
    const values = form.getValues();
    const description = values.description.trim();
    await saveAndAdvance({
      step: "prompts",
      data: {
        rankingPrompt: values.rankingPrompt.trim(),
        shortlistPrompt: values.shortlistPrompt.trim(),
        ...(description !== "" ? { description } : {}),
      },
    });
  };
  const activate = async (): Promise<void> => {
    if (!(await form.trigger(["pipelineTime", "emailTime", "timezone"]))) return;
    const values = form.getValues();
    setSaveError(null);
    try {
      await patchMutation.mutateAsync({
        step: "schedule",
        data: {
          pipelineTime: values.pipelineTime,
          emailTime: values.emailTime,
          timezone: values.timezone,
        },
      });
    } catch {
      setSaveError("Couldn’t save the schedule. Try again.");
      return;
    }
    activateMutation.mutate();
  };

  const busy = patchMutation.isPending;
  const completed = new Set(state.onboarding.completed);

  const steps: ReactElement[] = [
    <NameStep key="name" form={form} busy={busy} onContinue={() => void continueName()} />,
    <SlugStep
      key="slug"
      form={form}
      busy={busy}
      currentSlug={currentSlug}
      onBack={() => { go(stepIndex - 1); }}
      onContinue={() => void continueSlug()}
    />,
    <LogoStep
      key="logo"
      busy={busy}
      onBack={() => { go(stepIndex - 1); }}
      onDone={() => void saveAndAdvance({ step: "logo" })}
      onUploaded={setLogoVersion}
    />,
    <HomepageStep
      key="homepage"
      form={form}
      busy={busy}
      onBack={() => { go(stepIndex - 1); }}
      onContinue={() => void continueHomepage()}
    />,
    <PromptsStep
      key="prompts"
      form={form}
      busy={busy}
      generating={generateMutation.isPending}
      generateError={
        generateMutation.isError
          ? "Prompt generation is unavailable right now — you can paste prompts manually."
          : null
      }
      onGenerate={() => {
        const description = form.getValues("description").trim();
        if (description.length < 10) {
          form.setError("description", { message: "Describe your newsletter first (a sentence or two)." });
          return;
        }
        form.clearErrors("description");
        generateMutation.mutate(description);
      }}
      onBack={() => { go(stepIndex - 1); }}
      onContinue={() => void continuePrompts()}
    />,
    <ChannelsStep
      key="channels"
      busy={busy}
      onBack={() => { go(stepIndex - 1); }}
      onDone={() => void saveAndAdvance({ step: "channels" })}
    />,
    <SourcesStep
      key="sources"
      busy={busy}
      defaultTopic={form.getValues("description") || form.getValues("name")}
      onBack={() => { go(stepIndex - 1); }}
      onContinue={() => void saveAndAdvance({ step: "sources" })}
    />,
    <ScheduleStep
      key="schedule"
      form={form}
      slug={slug}
      activating={activateMutation.isPending || busy}
      missing={missing}
      onBack={() => { go(stepIndex - 1); }}
      onActivate={() => void activate()}
      onGoToStep={goToStep}
    />,
  ];

  return (
    <div className="min-h-screen bg-[#fbfaf7] font-sans text-[#14110d]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#e7e2d6] bg-[#fbfaf7] px-7 py-3">
        <span className="flex items-center gap-2.5">
          <BrandMark size={22} className="text-[#8c3a1e]" />
          <span className="font-mono text-[15px] font-semibold uppercase tracking-[0.12em]">
            {name.trim() || "Your newsletter"}
          </span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Setup · step <b className="text-[#8c3a1e]">{stepIndex + 1}</b> of {stepCount}
        </span>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-[13px] text-[#6b6557] hover:text-[#14110d]"
          onClick={() => void navigate("/admin")}
        >
          Save &amp; exit
        </button>
      </header>
      <div aria-hidden className="h-[3px] bg-[#e7e2d6]">
        <i
          className="block h-full bg-[#8c3a1e] transition-[width] duration-300"
          style={{ width: `${String(((stepIndex + 1) / stepCount) * 100)}%` }}
        />
      </div>

      <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 md:grid-cols-[250px_1fr] xl:grid-cols-[250px_1fr_minmax(380px,42%)]">
        <nav aria-label="Setup steps" className="hidden border-r border-[#e7e2d6] p-5 md:block">
          <ol className="m-0 list-none space-y-0.5 p-0">
            {ONBOARDING_STEP_ORDER.map((step, idx) => {
              const isActive = idx === stepIndex;
              const isDone = completed.has(step) || idx < stepIndex;
              return (
                <li key={step}>
                  <button
                    type="button"
                    aria-current={isActive ? "step" : undefined}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left ${
                      isActive ? "bg-[#f3efe6]" : "hover:bg-[#14110d]/[0.03]"
                    }`}
                    onClick={() => { go(idx); }}
                  >
                    <span
                      aria-hidden
                      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border font-mono text-[11px] ${
                        isActive
                          ? "border-[#8c3a1e] bg-[#8c3a1e] text-white"
                          : isDone
                            ? "border-[#2e6b3f] bg-[#2e6b3f] text-white"
                            : "border-[#d4ceba] bg-white text-[#6b6557]"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span>
                      <span
                        className={`block text-[13px] ${isActive ? "font-semibold text-[#14110d]" : "text-[#3d382f]"}`}
                      >
                        {STEP_TITLES[step]}
                      </span>
                      <span className="block font-mono text-[8.5px] uppercase tracking-[0.1em] text-[#8a8472]">
                        {REQUIRED_TAGS[step]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="overflow-auto px-7 py-9 md:px-11">
          {steps[stepIndex]}
          {saveError ? (
            <p role="alert" className="mt-4 font-mono text-[12px] text-[#9e2b1a]">
              {saveError}
            </p>
          ) : null}
        </main>

        <LivePreview
          branding={{
            name,
            slug,
            headline,
            topicStrip,
            subtagline,
            logoVersion,
          }}
        />
      </div>
    </div>
  );
}
