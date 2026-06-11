/**
 * Optional logo step (REQ-029/039). Uploads raw bytes; the API sniffs the
 * type and rejects oversize/unsupported files — a rejection leaves any
 * previously stored logo unchanged, and the error is surfaced inline.
 */
import { useRef, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { uploadLogo } from "../../api/onboarding";
import { StepHeading } from "./fields";

const ERROR_COPY: Record<string, string> = {
  too_large: "That file is over 512 KB — please upload a smaller image.",
  unsupported_type: "Unsupported file type — use PNG, JPEG, SVG, or WebP.",
};

export interface LogoStepProps {
  /** A logo is already stored server-side (resume case). */
  hasLogo: boolean;
  /** Called with a local preview URL after a successful upload. */
  onUploaded: (previewUrl: string | null) => void;
}

export function LogoStep({ hasLogo, onUploaded }: LogoStepProps): ReactElement {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => uploadLogo(file),
    onError: (err: Error) => {
      setError(ERROR_COPY[err.message] ?? err.message);
    },
  });

  const handleFile = (file: File | undefined): void => {
    if (file === undefined) return;
    setError(null);
    upload.mutate(file, {
      onSuccess: () => {
        setUploaded(true);
        const previewUrl =
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : null;
        onUploaded(previewUrl);
      },
    });
  };

  return (
    <div>
      <StepHeading
        step={3}
        title="Add your logo"
        blurb="Optional — appears in your masthead and emails. PNG, JPEG, SVG, or WebP up to 512 KB."
      />
      <button
        type="button"
        className="w-full cursor-pointer rounded-xl border-[1.5px] border-dashed border-[#d8d2c2] bg-[#fafaf7] p-7 text-center transition-colors hover:border-[#8c3a1e] hover:bg-[#8c3a1e]/[0.03]"
        onClick={() => fileInput.current?.click()}
      >
        <span aria-hidden="true" className="text-[22px] text-[#a39d8d]">
          ⬆
        </span>
        <span className="mt-2 block text-[14px] text-[#14110d]">
          Drop an image or <span className="text-[#8c3a1e]">browse</span>
        </span>
        <span className="mt-0.5 block text-[12.5px] text-[#6b6557]">
          Square works best (≥ 256×256). Max 512 KB.
        </span>
      </button>
      <input
        ref={fileInput}
        type="file"
        aria-label="Upload logo"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="sr-only"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
        }}
      />
      <p role="status" className="mt-3 min-h-[20px] text-[13px]">
        {upload.isPending ? (
          <span className="text-[#6b6557]">Uploading…</span>
        ) : error !== null ? (
          <span className="text-[#a33b2a]">{error}</span>
        ) : uploaded ? (
          <span className="text-[#3a7d44]">Logo uploaded.</span>
        ) : hasLogo ? (
          <span className="text-[#6b6557]">
            A logo is already saved — upload again to replace it.
          </span>
        ) : null}
      </p>
    </div>
  );
}
