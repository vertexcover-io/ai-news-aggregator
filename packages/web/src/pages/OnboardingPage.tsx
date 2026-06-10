import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  useForm,
  FormProvider,
  useWatch,
  useFormContext,
} from "react-hook-form";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getProgress,
  patchStep,
  activate,
  ActivationIncompleteError,
} from "@/api/onboarding";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shell/BrandMark";
import { StepRail } from "@/components/onboarding/StepRail";
import { LivePreview } from "@/components/onboarding/LivePreview";
import { NameStep } from "@/components/onboarding/NameStep";
import { SlugStep } from "@/components/onboarding/SlugStep";
import { LogoStep } from "@/components/onboarding/LogoStep";
import { HomepageStep } from "@/components/onboarding/HomepageStep";
import { PromptsStep } from "@/components/onboarding/PromptsStep";
import { ChannelsStep } from "@/components/onboarding/ChannelsStep";
import { SourcesStep } from "@/components/onboarding/SourcesStep";
import { ScheduleStep } from "@/components/onboarding/ScheduleStep";
import {
  emptyWizardData,
  fromProgressData,
  STEP_COUNT,
  type WizardData,
} from "@/components/onboarding/types";
import { canActivate } from "@/components/onboarding/activation";

function PreviewPane(): ReactElement {
  const { control } = useFormContext<WizardData>();
  const name = useWatch({ control, name: "name" });
  const slug = useWatch({ control, name: "slug" });
  const headline = useWatch({ control, name: "headline" });
  const topicStrip = useWatch({ control, name: "topicStrip" });
  const subtagline = useWatch({ control, name: "subtagline" });
  const hasLogo = useWatch({ control, name: "hasLogo" });
  const logoVersion = useWatch({ control, name: "logoVersion" });
  return (
    <LivePreview
      name={name}
      slug={slug}
      headline={headline}
      topicStrip={topicStrip}
      subtagline={subtagline}
      logoUrl={hasLogo ? `/api/tenant/logo?v=${String(logoVersion)}` : null}
    />
  );
}

export function OnboardingPage(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const form = useForm<WizardData>({ defaultValues: emptyWizardData() });

  const progressQuery = useQuery({
    queryKey: ["onboarding", "progress"],
    queryFn: getProgress,
  });

  if (!hydrated && progressQuery.data) {
    setHydrated(true);
    form.reset(fromProgressData(progressQuery.data.data));
    const fs = progressQuery.data.furthestStep || 0;
    setFurthest(fs);
    setStep(Math.min(fs, STEP_COUNT - 1));
  }

  const saveMutation = useMutation({
    mutationFn: (input: { furthestStep: number; data: WizardData }) =>
      patchStep({
        furthestStep: input.furthestStep,
        data: input.data as unknown as Record<string, unknown>,
      }),
  });

  function persist(nextFurthest: number): void {
    saveMutation.mutate({
      furthestStep: nextFurthest,
      data: form.getValues(),
    });
  }

  function goTo(index: number): void {
    if (index < 0 || index >= STEP_COUNT) return;
    if (index > furthest) return;
    setStep(index);
  }

  function advance(): void {
    const next = Math.min(step + 1, STEP_COUNT - 1);
    const nf = Math.max(furthest, next);
    setFurthest(nf);
    setStep(next);
    persist(nf);
  }

  function back(): void {
    setStep((s) => Math.max(0, s - 1));
  }

  const activateMutation = useMutation({
    mutationFn: activate,
    onSuccess: () => {
      toast.success("Newsletter activated");
      void navigate("/admin");
    },
    onError: (err: unknown) => {
      if (err instanceof ActivationIncompleteError) {
        toast.error(`Complete required steps: ${err.missing.join(", ")}`);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Activation failed");
    },
  });

  function handleActivate(): void {
    persist(STEP_COUNT - 1);
    activateMutation.mutate();
  }

  const values = useWatch({ control: form.control }) as WizardData;
  const activatable = canActivate({ ...emptyWizardData(), ...values });

  return (
    <FormProvider {...form}>
      <div className="min-h-screen bg-[#f7f3ea] text-[#14110d]">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[#e7e2d6] bg-[#f7f3ea] px-7 py-3">
          <div className="flex items-center gap-2">
            <BrandMark size={22} className="text-[#8c3a1e]" />
            <span className="font-mono text-[15px] font-semibold tracking-[0.1em] uppercase">
              Setup
            </span>
          </div>
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#6b6557]">
            Setup · step <b className="text-[#8c3a1e]">{step + 1}</b> of{" "}
            {STEP_COUNT}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              persist(furthest);
              void navigate("/admin");
            }}
          >
            Save & exit
          </Button>
        </div>
        <div className="h-[3px] bg-[#e7e2d6]">
          <div
            className="h-full bg-[#8c3a1e] transition-[width] duration-300"
            style={{ width: `${String(((step + 1) / STEP_COUNT) * 100)}%` }}
            data-testid="progress-bar"
          />
        </div>

        <div className="grid min-h-[calc(100vh-54px)] grid-cols-1 sm:grid-cols-[210px_1fr] lg:grid-cols-[250px_1fr_1fr]">
          <StepRail current={step} furthest={furthest} onGo={goTo} />
          <section className="overflow-auto p-6 sm:p-10">
            {step === 0 && <NameStep onContinue={advance} />}
            {step === 1 && <SlugStep onBack={back} onContinue={advance} />}
            {step === 2 && <LogoStep onBack={back} onContinue={advance} />}
            {step === 3 && <HomepageStep onBack={back} onContinue={advance} />}
            {step === 4 && <PromptsStep onBack={back} onContinue={advance} />}
            {step === 5 && <ChannelsStep onBack={back} onContinue={advance} />}
            {step === 6 && <SourcesStep onBack={back} onContinue={advance} />}
            {step === 7 && (
              <>
                <ScheduleStep onBack={back} />
                <div className="mt-6 max-w-[460px]">
                  <div className="rounded-md border border-[#e7e2d6] bg-white p-3 text-sm text-[#6b6557]">
                    {activatable
                      ? "You're all set on the required steps. Activating makes your site live and starts your daily runs."
                      : "Complete all required steps before activating."}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      disabled={!activatable || activateMutation.isPending}
                      onClick={handleActivate}
                      className="bg-[#8c3a1e] px-6 text-white hover:bg-[#7a3219]"
                    >
                      {activateMutation.isPending
                        ? "Activating…"
                        : "Activate newsletter ✦"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
          <PreviewPane />
        </div>
      </div>
    </FormProvider>
  );
}
