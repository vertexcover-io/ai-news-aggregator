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

function LinkedInIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.28V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.967 6.817H1.677l7.73-8.835L1.254 2.25h6.83l4.713 6.231 5.447-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
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
      className="mt-2 mb-8 flex flex-wrap items-center gap-3"
    >
      <a
        href={linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this issue on LinkedIn"
        data-share-target="linkedin"
        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 font-mono text-[11px] uppercase tracking-[0.18em] bg-[#8C3A1E] text-[#FAFAF7] hover:bg-[#6E2D17] transition-colors"
      >
        <LinkedInIcon />
        SHARE ON LINKEDIN
      </a>

      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share this issue on X"
        data-share-target="x"
        className="inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-900 border border-neutral-900 hover:bg-neutral-900 hover:text-[#FAFAF7] transition-colors"
      >
        <XIcon />
        POST ON X
      </a>

      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label="Copy archive link"
        data-share-target="copy"
        className={`inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
          copyState === "copied"
            ? "text-[#8C3A1E]"
            : "text-neutral-700 hover:text-[#8C3A1E]"
        }`}
      >
        <LinkIcon />
        {copyLabel}
      </button>

      <span aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Copied" : ""}
      </span>
    </div>
  );
}
