import { useEffect, useState, type ReactElement } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkSlug, type SlugStatus } from "@/api/onboarding";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface SlugStepProps {
  onBack: () => void;
  onContinue: () => void;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(value); }, delayMs);
    return () => { clearTimeout(id); };
  }, [value, delayMs]);
  return debounced;
}

export function SlugStep({ onBack, onContinue }: SlugStepProps): ReactElement {
  const { register, control } = useFormContext<WizardData>();
  const slug = useWatch({ control, name: "slug" });
  const normalized = (slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const debouncedSlug = useDebounced(normalized, 350);

  const query = useQuery({
    queryKey: ["onboarding", "slug-check", debouncedSlug],
    queryFn: () => checkSlug(debouncedSlug),
    enabled: debouncedSlug.length > 0,
    staleTime: 30_000,
  });

  const status: SlugStatus | "pending" | null =
    debouncedSlug.length === 0
      ? null
      : query.isFetching
        ? "pending"
        : (query.data ?? null);

  const available = status === "available";

  return (
    <StepShell
      stepNumber={2}
      title="Pick your address"
      blurb="Choose a subdomain. Your public newsletter lives here. You can change it later (old links redirect)."
      onBack={onBack}
      onContinue={onContinue}
      continueDisabled={!available}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ob-slug">Subdomain</Label>
        <div className="flex items-center gap-1">
          <Input id="ob-slug" {...register("slug")} className="flex-1" />
          <span className="font-mono text-sm text-[#6b6557]">.ourdomain.com</span>
        </div>
        <div
          data-testid="slug-availability"
          aria-live="polite"
          className="mt-1 flex items-center gap-2 font-mono text-[11px] tracking-[0.04em]"
        >
          {status === "pending" ? (
            <span className="text-[#6b6557]">Checking availability…</span>
          ) : status === "available" ? (
            <span className="flex items-center gap-2 text-[#3f7d4e]">
              <span className="inline-block size-2 rounded-full bg-[#3f7d4e]" />
              {normalized}.ourdomain.com is available
            </span>
          ) : status === "taken" ? (
            <span className="flex items-center gap-2 text-[#b3261e]">
              <span className="inline-block size-2 rounded-full bg-[#b3261e]" />
              {normalized}.ourdomain.com is taken
            </span>
          ) : status === "invalid" ? (
            <span className="flex items-center gap-2 text-[#b3261e]">
              <span className="inline-block size-2 rounded-full bg-[#b3261e]" />
              Not a valid subdomain
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[#9b9384]">
          Lowercase letters, numbers, and hyphens. Reserved words like{" "}
          <span className="font-mono">app</span>,{" "}
          <span className="font-mono">admin</span>,{" "}
          <span className="font-mono">api</span> aren&apos;t allowed.
        </p>
      </div>
    </StepShell>
  );
}
