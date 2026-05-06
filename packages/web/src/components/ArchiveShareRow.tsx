import { useEffect, useRef, useState, type ReactElement } from "react";
import { buildLinkedInShareUrl, buildXShareUrl } from "../lib/shareLinks";

interface Props {
  archiveUrl: string;
  shareText: string;
}

type CopyState = "idle" | "copied" | "failed";

interface NavigatorClipboardLike {
  clipboard?: { writeText: (s: string) => Promise<void> };
}

export function ArchiveShareRow({
  archiveUrl,
  shareText,
}: Props): ReactElement {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const linkedInUrl = buildLinkedInShareUrl(archiveUrl);
  const xUrl = buildXShareUrl(archiveUrl, shareText);

  function flash(state: "copied" | "failed"): void {
    setCopyState(state);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      timerRef.current = null;
    }, 1500);
  }

  async function handleCopy(): Promise<void> {
    try {
      const clip = (navigator as NavigatorClipboardLike).clipboard;
      if (clip !== undefined) {
        await clip.writeText(archiveUrl);
        flash("copied");
        return;
      }
      const ta = document.createElement("textarea");
      ta.value = archiveUrl;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok =
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          typeof document.execCommand === "function" &&
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
      if (ok) {
        flash("copied");
      } else {
        console.warn("[ArchiveShareRow] copy fallback failed");
        flash("failed");
      }
    } catch (err) {
      console.warn("[ArchiveShareRow] copy failed", err);
      flash("failed");
    }
  }

  const copyLabel =
    copyState === "copied"
      ? "COPIED ✓"
      : copyState === "failed"
        ? "COPY FAILED"
        : "COPY LINK";

  return (
    <div
      data-testid="archive-share-row"
      className="mt-2 mb-8 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500"
    >
      <span aria-hidden="true" className="text-neutral-400">
        SHARE →
      </span>

      <a
        href={linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this issue on LinkedIn"
        data-share-target="linkedin"
        className="inline-flex items-center gap-2 min-h-[44px] px-2 hover:text-[#8C3A1E] transition-colors"
      >
        LINKEDIN
      </a>

      <span aria-hidden="true" className="text-neutral-300 select-none">
        ·
      </span>

      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this issue on X"
        data-share-target="x"
        className="inline-flex items-center gap-2 min-h-[44px] px-2 hover:text-[#8C3A1E] transition-colors"
      >
        X
      </a>

      <span aria-hidden="true" className="text-neutral-300 select-none">
        ·
      </span>

      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label="Copy archive link"
        data-share-target="copy"
        className={`inline-flex items-center gap-2 min-h-[44px] px-2 transition-colors ${
          copyState === "copied" ? "text-[#8C3A1E]" : "hover:text-[#8C3A1E]"
        }`}
      >
        {copyLabel}
      </button>

      <span aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Copied" : ""}
      </span>
    </div>
  );
}
