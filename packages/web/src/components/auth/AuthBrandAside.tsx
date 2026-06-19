import type { ReactElement } from "react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * The dark "ink" brand panel for the two-column auth pages (signup, login),
 * matching `mocks/signup.html`. Dispatch is the platform brand on the
 * app host — these pages are pre-login and not tenant-scoped, so the wordmark
 * is fixed (no `useTenantBranding`). On the ink background the accent uses the
 * lighter coral (`#e98f6e`) the mock specifies, not the darker page rust.
 */
interface AuthBrandAsideProps {
  kicker: string;
  /** Headline with the trailing accent clause italicised in coral. */
  headline: string;
  accent: string;
  lede: string;
  /** Onboarding step strip (signup). Mutually exclusive with `tagline`. */
  steps?: string[];
  /** A single mono tagline (login), shown where the steps would be. */
  tagline?: string;
}

export function AuthBrandAside({
  kicker,
  headline,
  accent,
  lede,
  steps,
  tagline,
}: AuthBrandAsideProps): ReactElement {
  return (
    <div className="flex h-full flex-col justify-between gap-12">
      <div className="flex items-center gap-2.5">
        <BrandMark size={26} className="text-[#e98f6e]" />
        <span className="font-mono text-base font-semibold uppercase tracking-[0.12em] text-white">
          Dispatch
        </span>
      </div>

      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-cream/55">
          {kicker}
        </p>
        <h2 className="mt-3 font-serif text-[clamp(30px,3.6vw,46px)] font-medium leading-[1.08] tracking-[-0.018em] text-cream">
          {headline} <em className="italic text-[#e98f6e]">{accent}</em>
        </h2>
        <p className="mt-[18px] max-w-[40ch] font-serif text-[18px] leading-[1.5] text-cream/70">
          {lede}
        </p>
      </div>

      {steps ? (
        <p className="font-mono text-[11px] uppercase leading-[2.1] tracking-[0.18em] text-cream/55">
          {steps.map((step, i) => (
            <span key={step}>
              {step}
              {i < steps.length - 1 && <span className="text-[#e98f6e]"> → </span>}
            </span>
          ))}
        </p>
      ) : tagline ? (
        <p className="font-mono text-[11px] uppercase leading-[2.1] tracking-[0.18em] text-cream/55">
          {tagline}
        </p>
      ) : null}
    </div>
  );
}
