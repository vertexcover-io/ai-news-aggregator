import { Fragment, type ReactElement } from "react";
import type { TenantBranding } from "@newsletter/shared/types/tenant";

/** "… ship with agents." → ["… ship with", "agents."] — the last word gets the rust italic accent. */
function splitHeadline(headline: string): [string, string] {
  const trimmed = headline.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return ["", trimmed];
  return [trimmed.slice(0, lastSpace), trimmed.slice(lastSpace + 1)];
}

/** Non-breaking spaces inside each strip segment, exactly as the legacy markup. */
function noBreak(segment: string): string {
  return segment.replace(/ /g, " ");
}

/**
 * The public homepage hero (P7 branding slots: headline, topic strip,
 * subtagline). Extracted from HomePage so the onboarding wizard's live
 * preview renders the EXACT same component with in-progress branding
 * (P11, REQ-034) — the layout is fixed, tenants only fill the slots.
 */
export function Hero({ branding }: { branding: TenantBranding }): ReactElement {
  const [lead, accent] = splitHeadline(branding.headline ?? "");
  const stripSegments = (branding.topicStrip ?? "")
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return (
    <section className="pt-16 pb-14 text-center">
      <h1 className="font-serif font-medium text-[clamp(40px,6.4vw,68px)] leading-[1.02] tracking-[-0.018em] m-0 mx-auto max-w-[14ch] text-[#14110d]">
        {lead}
        {lead ? " " : null}
        <span className="text-[#8c3a1e] italic font-medium">{accent}</span>
      </h1>
      {stripSegments.length > 0 ? (
        <div className="mt-9 mx-auto font-mono text-[11px] tracking-[0.22em] uppercase text-[#14110d] max-w-[820px] leading-[2]">
          {stripSegments.map((segment, index) => (
            <Fragment key={segment}>
              {index > 0 ? (
                <>
                  {" "}
                  <span className="text-[#8c3a1e] mx-2.5">·</span>{" "}
                </>
              ) : null}
              {noBreak(segment)}
            </Fragment>
          ))}
        </div>
      ) : null}
      {branding.subtagline ? (
        <div className="mt-5 mx-auto font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6b6557] max-w-[760px]">
          {branding.subtagline}
        </div>
      ) : null}
    </section>
  );
}
