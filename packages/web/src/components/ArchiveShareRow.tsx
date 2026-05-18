import { useEffect, useRef, useState, type ReactElement } from "react";
import { buildLinkedInShareUrl, buildXShareUrl } from "../lib/shareLinks";
import { captureBrowserEvent } from "../lib/analytics";

interface Props {
  archiveUrl: string;
  shareText: string;
  runId?: string;
}

type CopyState = "idle" | "copied" | "failed";

interface NavigatorClipboardLike {
  clipboard?: { writeText: (s: string) => Promise<void> };
}

function XIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
    >
      <path d="M18.244 2H21.5l-7.46 8.523L23 22h-6.953l-5.444-7.114L4.32 22H1.062l7.973-9.118L1 2h7.116l4.93 6.514L18.244 2zm-2.44 18h1.81L7.27 4H5.32L15.804 20z" />
    </svg>
  );
}

function LinkedInIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
    >
      <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5V9h3v10zM6.5 7.7A1.7 1.7 0 1 1 6.5 4.3a1.7 1.7 0 0 1 0 3.4zM19 19h-3v-5.5c0-1.4-.5-2.3-1.7-2.3a1.85 1.85 0 0 0-1.7 1.2 2.3 2.3 0 0 0-.1.8V19h-3V9h3v1.3a3 3 0 0 1 2.7-1.5c2 0 3.5 1.3 3.5 4.1V19z" />
    </svg>
  );
}

function LinkIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const iconBtn =
  "inline-flex h-[30px] w-[30px] min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-[#6b6557] transition-colors hover:bg-[#f1ede2] hover:text-[#8c3a1e] sm:min-h-[30px] sm:min-w-[30px]";

export function ArchiveShareRow({ archiveUrl, shareText, runId }: Props): ReactElement {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return (): void => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const linkedInUrl = buildLinkedInShareUrl(archiveUrl);
  const xUrl = buildXShareUrl(archiveUrl, shareText);

  function flash(state: "copied" | "failed"): void {
    setCopyState(state);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      timerRef.current = null;
    }, 1500);
  }

  async function handleCopy(): Promise<void> {
    captureBrowserEvent("archive_share_clicked", {
      target: "copy",
      run_id: runId,
    });
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
      if (ok) flash("copied");
      else {
        flash("failed");
      }
    } catch {
      flash("failed");
    }
  }

  const copyTextLabel =
    copyState === "copied"
      ? "COPIED ✓"
      : copyState === "failed"
        ? "COPY FAILED"
        : "COPY LINK";

  return (
    <div className="mx-auto mb-9 flex items-center justify-center border-b border-[#e7e2d6] pb-7">
      <div
        data-testid="archive-share-row"
        className="relative inline-flex items-center gap-1"
        role="group"
        aria-label="Share this issue"
      >
        <span className="mr-[10px] font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#8a8472]">
          Share
        </span>
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share this issue on X"
          data-share-target="x"
          onClick={() => {
            captureBrowserEvent("archive_share_clicked", {
              target: "x",
              run_id: runId,
            });
          }}
          className={iconBtn}
        >
          <XIcon />
          <span className="sr-only">POST ON X</span>
        </a>
        <a
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share this issue on LinkedIn"
          data-share-target="linkedin"
          onClick={() => {
            captureBrowserEvent("archive_share_clicked", {
              target: "linkedin",
              run_id: runId,
            });
          }}
          className={iconBtn}
        >
          <LinkedInIcon />
          <span className="sr-only">SHARE ON LINKEDIN</span>
        </a>
        <button
          type="button"
          aria-label="Copy archive link"
          data-share-target="copy"
          onClick={() => {
            void handleCopy();
          }}
          className={`${iconBtn} ${copyState === "copied" ? "text-[#8c3a1e]" : ""}`}
        >
          <LinkIcon />
          <span className="sr-only">{copyTextLabel}</span>
        </button>
        <span
          aria-hidden="true"
          className={`absolute left-full top-1/2 -translate-y-1/2 pl-[10px] font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#8c3a1e] transition-opacity duration-200 ${copyState === "copied" ? "opacity-100" : "opacity-0"}`}
        >
          Copied
        </span>
        <span aria-live="polite" className="sr-only">
          {copyState === "copied" ? "Copied" : ""}
        </span>
      </div>
    </div>
  );
}
