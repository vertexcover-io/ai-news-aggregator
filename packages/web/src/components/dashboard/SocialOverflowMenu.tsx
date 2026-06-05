import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    function updatePosition(): void {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
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

  const editEligible = run.status === "completed" && run.reviewed;

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
        {open && menuPosition
          ? createPortal(
              <div
                ref={menuRef}
                role="menu"
                style={{ top: menuPosition.top, right: menuPosition.right }}
                className="fixed z-50 min-w-[12rem] rounded-md border bg-white shadow-md"
              >
                {editEligible ? (
                  <Link
                    role="menuitem"
                    to={`/admin/review/${run.runId}`}
                    onClick={() => { setOpen(false); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    Edit newsletter
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    aria-disabled="true"
                    disabled
                    className="block w-full px-3 py-2 text-left text-sm opacity-50 cursor-not-allowed"
                  >
                    Edit newsletter
                  </button>
                )}
                {renderChannelItem("linkedin")}
                {renderChannelItem("twitter")}
              </div>,
              document.body,
            )
          : null}
      </div>
    </>
  );
}
