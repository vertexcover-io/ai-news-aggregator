import { useEffect, useRef, useState, type ReactElement } from "react";
import type { RunSummary } from "@newsletter/shared";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type SocialChannel = "linkedin" | "twitter";

interface ChannelState {
  posted: boolean;
  permalink: string | null;
  eligible: boolean;
}

function deriveChannelState(
  run: RunSummary,
  channel: SocialChannel,
): ChannelState {
  const postedAt =
    channel === "linkedin" ? run.linkedinPostedAt : run.twitterPostedAt;
  const permalink =
    channel === "linkedin"
      ? (run.linkedinPermalink ?? null)
      : (run.twitterPermalink ?? null);

  if (postedAt != null) {
    return { posted: true, permalink, eligible: false };
  }

  const eligible =
    run.status === "completed" && run.reviewed && !run.isDryRun;

  return { posted: false, permalink: null, eligible };
}

interface SocialOverflowMenuProps {
  run: RunSummary;
  runDate: string;
  onPostConfirm: (channel: SocialChannel) => void;
  isPending: boolean;
}

export function SocialOverflowMenu({
  run,
  runDate,
  onPostConfirm,
  isPending,
}: SocialOverflowMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [confirmChannel, setConfirmChannel] = useState<SocialChannel | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const linkedin = deriveChannelState(run, "linkedin");
  const twitter = deriveChannelState(run, "twitter");

  function handleMenuItemClick(channel: SocialChannel): void {
    const state = channel === "linkedin" ? linkedin : twitter;
    if (state.posted || !state.eligible || isPending) return;
    setOpen(false);
    setConfirmChannel(channel);
  }

  function handleConfirm(): void {
    if (confirmChannel === null) return;
    onPostConfirm(confirmChannel);
    setConfirmChannel(null);
  }

  const channelLabel: Record<SocialChannel, string> = {
    linkedin: "LinkedIn",
    twitter: "X",
  };

  function renderChannelItem(channel: SocialChannel): ReactElement {
    const state = channel === "linkedin" ? linkedin : twitter;
    const label = channelLabel[channel];

    if (state.posted) {
      if (state.permalink != null) {
        return (
          <a
            key={channel}
            role="menuitem"
            href={state.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50"
            onClick={() => { setOpen(false); }}
          >
            {label} ✓ View post ↗
          </a>
        );
      }
      return (
        <div
          key={channel}
          role="menuitem"
          aria-disabled="true"
          className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm text-emerald-700 opacity-70"
        >
          {label} ✓ Posted
        </div>
      );
    }

    const disabled = !state.eligible || isPending;
    return (
      <button
        key={channel}
        type="button"
        role="menuitem"
        aria-disabled={disabled ? "true" : undefined}
        disabled={disabled}
        onClick={() => { handleMenuItemClick(channel); }}
        className={cn(
          "block w-full px-3 py-2 text-left text-sm hover:bg-gray-50",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        Post to {label}
      </button>
    );
  }

  const confirmLabel =
    confirmChannel != null ? channelLabel[confirmChannel] : "";

  return (
    <>
      <Dialog
        open={confirmChannel !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmChannel(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Post to {confirmLabel}?</DialogTitle>
            <DialogDescription>
              Post the {runDate} digest to {confirmLabel} now? This publishes
              publicly.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setConfirmChannel(null); }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => { handleConfirm(); }}
            >
              Post now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={containerRef} className="relative inline-flex">
        <Button
          variant="ghost"
          size="icon"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen((v) => !v); }}
        >
          <MoreHorizontal />
        </Button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] rounded-md border bg-white shadow-md"
          >
            {renderChannelItem("linkedin")}
            {renderChannelItem("twitter")}
          </div>
        ) : null}
      </div>
    </>
  );
}
