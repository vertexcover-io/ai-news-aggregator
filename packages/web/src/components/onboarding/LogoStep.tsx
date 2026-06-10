import { useRef, useState, type ReactElement } from "react";
import { useFormContext } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { uploadLogo } from "@/api/onboarding";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

const MAX_BYTES = 512 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

interface LogoStepProps {
  onBack: () => void;
  onContinue: () => void;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => { reject(new Error("read failed")); };
    reader.readAsDataURL(file);
  });
}

export function LogoStep({ onBack, onContinue }: LogoStepProps): ReactElement {
  const { setValue, getValues } = useFormContext<WizardData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const hasLogo = getValues("hasLogo");

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const data = await readAsBase64(file);
      return uploadLogo(file.type, data);
    },
    onSuccess: (res) => {
      setValue("hasLogo", true, { shouldDirty: true });
      setValue("logoVersion", res.logoVersion, { shouldDirty: true });
    },
    onError: () => { setError("Upload failed. Try again."); },
  });

  function handleFile(file: File | undefined): void {
    setError(null);
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setError("Use PNG, JPEG, SVG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Max 512 KB.");
      return;
    }
    mutation.mutate(file);
  }

  return (
    <StepShell
      stepNumber={3}
      title="Add your logo"
      blurb="Optional — appears in your masthead and emails. PNG, JPEG, SVG, or WebP up to 512 KB."
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onContinue}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-xl border-[1.5px] border-dashed border-[#c9c0ad] bg-[#f7f3ea] p-7 text-center transition-colors hover:border-[#8c3a1e] hover:bg-[#8c3a1e]/[.03]"
      >
        <div className="text-2xl text-[#9b9384]">⬆</div>
        <p className="mt-2 mb-0.5 text-sm text-[#14110d]">
          {mutation.isPending
            ? "Uploading…"
            : hasLogo
              ? "Logo uploaded — click to replace"
              : "Drop an image or browse"}
        </p>
        <p className="m-0 text-xs text-[#9b9384]">
          Square works best (≥ 256×256). Max 512 KB.
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(",")}
        className="hidden"
        aria-label="Upload logo"
        onChange={(e) => { handleFile(e.target.files?.[0]); }}
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[#b3261e]">
          {error}
        </p>
      ) : null}
    </StepShell>
  );
}
