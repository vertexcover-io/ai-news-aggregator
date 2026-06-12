import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Ledger-aesthetic auth form primitives, mirroring the mock `theme.css`
 * (`.input`, `.label`, `.kicker`, `.err`, `.help`). The four auth pages
 * compose these so the styling stays in one place and matches the public
 * site's editorial look (Newsreader serif headings, Geist Mono kickers/labels,
 * rust accents). Tokens (`--color-rust/-ink/-cream/-mute/-line-strong/-danger`)
 * are wired in `src/index.css`.
 */

/** `.input` — cream-elev surface, rust focus ring, danger ring on aria-invalid. */
export const authInputClass =
  "w-full min-h-[44px] rounded-[10px] border border-line-strong bg-cream-elev px-3 py-2.5 " +
  "text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-mute-2 " +
  "focus-visible:border-rust focus-visible:ring-[3px] focus-visible:ring-rust/15 " +
  "aria-invalid:border-danger aria-invalid:ring-[3px] aria-invalid:ring-danger/15";

/** `.kicker` — mono, uppercase, wide tracking. `tone="rust"` for the rust accent. */
export function Kicker({
  children,
  tone = "mute",
  className,
}: {
  children: ReactNode;
  tone?: "mute" | "rust";
  className?: string;
}): ReactElement {
  return (
    <p
      className={cn(
        "font-mono text-[10.5px] uppercase tracking-[0.22em]",
        tone === "rust" ? "text-rust" : "text-mute",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** `.label` — mono, uppercase, muted. */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label
      htmlFor={htmlFor}
      className="block font-mono text-[10.5px] uppercase tracking-[0.16em] text-mute"
    >
      {children}
    </label>
  );
}

/** `.err` — mono danger text. Keeps role="alert" + aria-live for tests/a11y. */
export function FormError({ children }: { children: ReactNode }): ReactElement {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="font-mono text-xs tracking-[0.02em] text-danger"
    >
      {children}
    </p>
  );
}

/** `.help` — muted secondary copy. */
export function Help({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <p className={cn("text-[12.5px] leading-relaxed text-mute", className)}>
      {children}
    </p>
  );
}

/** Serif display heading used for the form title (kept at the test-required level). */
export function DisplayHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <h1
      className={cn(
        "font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-ink",
        className,
      )}
    >
      {children}
    </h1>
  );
}
