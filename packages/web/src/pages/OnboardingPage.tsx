/**
 * Resumable onboarding wizard (P11, REQ-030–038, REQ-051).
 *
 * Eight-step carousel (mocks/onboarding.html): name → subdomain → logo →
 * homepage text → prompts → social/email → sources → schedule+activate,
 * with a live preview of the public homepage (the REAL P7 Hero, lorem
 * placeholders elsewhere) alongside. Progress persists to
 * tenants.onboardingState on every step navigation, so leaving and coming
 * back resumes exactly where the tenant stopped (REQ-030).
 *
 * Page stays thin (S-web-03): step forms live in components/onboarding/*;
 * the activation gate mirror lives in wizardSteps.ts; the server re-asserts
 * everything on POST /activate. The outer component only loads the saved
 * state; the inner Wizard initializes its local state from it directly
 * (no hydration effect, no setState-in-effect).
 */
import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OnboardingData,
  OnboardingStateResponse,
} from "@newsletter/shared/types/tenant";
import {
  ActivationBlockedError,
  activateOnboarding,
  getOnboarding,
  patchOnboarding,
} from "../api/onboarding";
import { useTenantSources } from "../hooks/useTenantSources";
import { BrandMark } from "../components/shell/BrandMark";
import { PreviewPane } from "../components/onboarding/PreviewPane";
import { NameStep } from "../components/onboarding/NameStep";
import { SlugStep } from "../components/onboarding/SlugStep";
import { LogoStep } from "../components/onboarding/LogoStep";
import { HomepageTextStep } from "../components/onboarding/HomepageTextStep";
import { PromptsStep } from "../components/onboarding/PromptsStep";
import { SocialStep } from "../components/onboarding/SocialStep";
import { SourcesStep } from "../components/onboarding/SourcesStep";
import { ScheduleStep } from "../components/onboarding/ScheduleStep";
import {
  WIZARD_STEPS,
  localMissingSteps,
  stepIndexForKey,
  type WizardStepKey,
} from "../components/onboarding/wizardSteps";
import {
  BTN_GHOST,
  BTN_OUTLINE,
  BTN_RUST,
} from "../components/onboarding/fields";

const OPTIONAL_STEPS: ReadonlySet<WizardStepKey> = new Set(["logo", "social"]);

const DEFAULT_TIMEZONE = ((): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
})();

export function OnboardingPage(): ReactElement {
  const onboardingQuery = useQuery({
    queryKey: ["onboarding"],
    queryFn: getOnboarding,
    refetchOnWindowFocus: false,
  });

  if (onboardingQuery.data === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fafaf7]">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-[#6b6557]">
          Loading setup…
        </p>
      </div>
    );
  }
  return <Wizard saved={onboardingQuery.data} />;
}

function Wizard({ saved }: { saved: OnboardingStateResponse }): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { query: sourcesQuery } = useTenantSources();

  const [stepIndex, setStepIndex] = useState(() =>
    stepIndexForKey(saved.state?.currentStep),
  );
  const [completed, setCompleted] = useState(
    () => saved.state?.completedSteps ?? [],
  );
  // Schedule slots default up-front (the step ships prefilled, per the
  // mock) — every other required slot starts empty and gates activation.
  const [draft, setDraft] = useState<OnboardingData>(() => ({
    pipelineTime: "06:00",
    emailTime: "07:30",
    timezone: DEFAULT_TIMEZONE,
    ...saved.state?.data,
  }));
  const [logoUrl, setLogoUrl] = useState(
    saved.hasLogo ? "/api/onboarding/logo" : null,
  );
  const [activationError, setActivationError] = useState<string | null>(null);

  const persist = useMutation({ mutationFn: patchOnboarding });

  const update = (patch: Partial<OnboardingData>): void => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const goTo = (targetIndex: number, markCurrentDone: boolean): void => {
    const current = WIZARD_STEPS[stepIndex];
    const nextCompleted =
      markCurrentDone && !completed.includes(current.key)
        ? [...completed, current.key]
        : completed;
    setCompleted(nextCompleted);
    setStepIndex(targetIndex);
    persist.mutate({
      currentStep: WIZARD_STEPS[targetIndex].key,
      completedSteps: nextCompleted,
      data: draft,
    });
  };

  const sourcesCount = sourcesQuery.data?.length ?? saved.sourcesCount;
  const missing = localMissingSteps(draft, sourcesCount);

  const activate = useMutation({
    mutationFn: async () => {
      // Persist the final state first so the server gate sees it.
      await patchOnboarding({
        currentStep: "schedule",
        completedSteps: completed,
        data: draft,
      });
      return activateOnboarding();
    },
    onSuccess: async () => {
      // Status flipped to active — refresh the session so RequireOnboarding
      // lets the dashboard through, then leave the wizard.
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate("/admin", { replace: true });
    },
    onError: (err: Error) => {
      if (err instanceof ActivationBlockedError) {
        setActivationError(
          err.blocked.error === "slug_taken"
            ? "That subdomain was just taken — pick another in the Subdomain step."
            : "Some required steps are incomplete — see the list above.",
        );
        return;
      }
      setActivationError(err.message);
    },
  });

  const step = WIZARD_STEPS[stepIndex];
  const isLast = stepIndex === WIZARD_STEPS.length - 1;

  return (
    <div className="min-h-screen bg-[#fafaf7] text-[#14110d]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#e7e2d6] bg-[#fafaf7] px-7 py-3">
        <span className="flex items-center gap-2.5">
          <BrandMark size={22} className="text-[#8c3a1e]" />
          <span className="font-mono text-[15px] font-semibold uppercase tracking-[0.12em]">
            Dispatch
          </span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Setup · step <b className="text-[#8c3a1e]">{stepIndex + 1}</b> of{" "}
          {WIZARD_STEPS.length}
        </span>
        <span aria-hidden="true" className="w-[120px]" />
      </header>
      <div aria-hidden="true" className="h-[3px] bg-[#e7e2d6]">
        <i
          className="block h-full bg-[#8c3a1e] transition-all duration-300"
          style={{
            width: `${String(((stepIndex + 1) / WIZARD_STEPS.length) * 100)}%`,
          }}
        />
      </div>

      <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 md:grid-cols-[250px_1fr] xl:grid-cols-[250px_1fr_minmax(380px,44%)]">
        {/* Step rail */}
        <nav
          aria-label="Setup steps"
          className="hidden border-r border-[#e7e2d6] p-5 md:block"
        >
          <ol className="m-0 list-none space-y-0.5 p-0">
            {WIZARD_STEPS.map((def, index) => {
              const active = index === stepIndex;
              const done = completed.includes(def.key);
              return (
                <li key={def.key}>
                  <button
                    type="button"
                    aria-current={active ? "step" : undefined}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                      active ? "bg-[#f3efe6]" : "hover:bg-[#14110d]/[0.03]"
                    }`}
                    onClick={() => {
                      goTo(index, false);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border font-mono text-[11px] ${
                        active
                          ? "border-[#8c3a1e] bg-[#8c3a1e] text-white"
                          : done
                            ? "border-[#3a7d44] bg-[#3a7d44] text-white"
                            : "border-[#d8d2c2] bg-white text-[#6b6557]"
                      }`}
                    >
                      {done && !active ? "✓" : index + 1}
                    </span>
                    <span>
                      <span
                        className={`block pt-0.5 text-[13px] ${
                          active
                            ? "font-semibold text-[#14110d]"
                            : "text-[#3f3a30]"
                        }`}
                      >
                        {def.railLabel}
                      </span>
                      <span className="block font-mono text-[8.5px] uppercase tracking-[0.1em] text-[#a39d8d]">
                        {def.tag}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Form column */}
        <section className="overflow-auto px-8 py-10 md:px-11">
          <div className="max-w-[480px]">
            {step.key === "name" ? (
              <NameStep data={draft} update={update} />
            ) : step.key === "slug" ? (
              <SlugStep data={draft} update={update} />
            ) : step.key === "logo" ? (
              <LogoStep
                hasLogo={saved.hasLogo}
                onUploaded={(previewUrl) => {
                  setLogoUrl(previewUrl ?? "/api/onboarding/logo");
                }}
              />
            ) : step.key === "homepage" ? (
              <HomepageTextStep data={draft} update={update} />
            ) : step.key === "prompts" ? (
              <PromptsStep data={draft} update={update} />
            ) : step.key === "social" ? (
              <SocialStep
                data={draft}
                update={update}
                onBeforeConnect={async () => {
                  // Persist the draft + step so the OAuth redirect round-trip
                  // resumes here with the tenant's input intact (Fix #2).
                  await patchOnboarding({
                    currentStep: "social",
                    completedSteps: completed,
                    data: draft,
                  });
                }}
              />
            ) : step.key === "sources" ? (
              <SourcesStep blurb={draft.blurb ?? ""} />
            ) : (
              <ScheduleStep
                data={draft}
                update={update}
                missing={missing}
                activating={activate.isPending}
                activationError={activationError}
                onActivate={() => {
                  setActivationError(null);
                  activate.mutate();
                }}
              />
            )}

            {/* Step actions */}
            <div className="mt-9 flex max-w-[480px] items-center justify-between border-t border-[#e7e2d6] pt-5">
              {stepIndex > 0 ? (
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  onClick={() => {
                    goTo(stepIndex - 1, false);
                  }}
                >
                  ← Back
                </button>
              ) : (
                <span />
              )}
              {!isLast ? (
                <span className="flex items-center gap-2">
                  {OPTIONAL_STEPS.has(step.key) ? (
                    <button
                      type="button"
                      className={BTN_GHOST}
                      onClick={() => {
                        goTo(stepIndex + 1, false);
                      }}
                    >
                      Skip
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={BTN_RUST}
                    onClick={() => {
                      goTo(stepIndex + 1, true);
                    }}
                  >
                    Continue →
                  </button>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {/* Live preview (REQ-034) */}
        <PreviewPane data={draft} logoUrl={logoUrl} />
      </div>
    </div>
  );
}
