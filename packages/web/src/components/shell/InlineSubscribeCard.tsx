import {
  useState,
  type ChangeEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { postSubscribe } from "../../api/subscribe";
import {
  brandDisplayName,
  useTenantBranding,
} from "../../hooks/useTenantBranding";
import { useIsSubscribed } from "../../hooks/useIsSubscribed";
import { markSubscribed } from "../../lib/subscriptionStorage";
import { captureBrowserEvent } from "../../lib/analytics";

type State = "idle" | "loading" | "success" | "error";

export function InlineSubscribeCard(): ReactElement | null {
  const [state, setState] = useState<State>("idle");
  const [email, setEmail] = useState("");
  const isSubscribed = useIsSubscribed();
  const branding = useTenantBranding();
  const displayName = brandDisplayName(branding);

  if (isSubscribed && state !== "success") return null;

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!email || state === "loading") return;
    setState("loading");
    captureBrowserEvent("subscribe_form_submitted", {
      source: "inline-card",
    });
    void postSubscribe(email).then((result) => {
      if ("error" in result) {
        captureBrowserEvent("subscribe_form_failed", {
          source: "inline-card",
          error_code: result.error,
        });
        setState("error");
      } else {
        captureBrowserEvent("subscribe_form_succeeded", {
          source: "inline-card",
        });
        setState("success");
        markSubscribed();
      }
    });
  };

  const onEmail = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value);
  };

  return (
    <section
      data-section="inline-subscribe"
      id="subscribe"
      className="py-16 text-center"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.24em] font-semibold text-[#8c3a1e] mb-3">
        Subscribe &mdash; free
      </div>
      <h3 className="font-serif font-medium text-[clamp(28px,3.4vw,40px)] leading-[1.1] tracking-[-0.014em] m-0 mb-[10px] text-[#14110d]">
        Subscribe to {displayName}&apos;s daily digest.
      </h3>
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6557] mb-8">
        {/* Tenant 0 keeps AgentLoop's AI-news framing; other tenants stay topic-neutral. */}
        {branding.isTenantZero
          ? "The AI news that matters, ranked. 7am every morning."
          : "The stories that matter, ranked. Daily."}
      </div>

      {state === "success" ? (
        <p className="font-serif italic text-lg text-[#2a261f]">
          Check your inbox to confirm your subscription.
        </p>
      ) : (
        <>
          <form
            data-purpose="subscribe"
            onSubmit={onSubmit}
            aria-label={`Subscribe to ${displayName}`}
            className="flex gap-0 max-w-[480px] mx-auto border-t border-b border-[#14110d]"
          >
            <input
              type="email"
              required
              aria-label="Email"
              placeholder="you@company.com"
              value={email}
              onChange={onEmail}
              disabled={state === "loading"}
              className="flex-1 min-w-0 bg-transparent border-0 px-[14px] py-4 font-serif text-[17px] text-[#14110d] outline-none placeholder:text-[#6b6557] placeholder:italic"
            />
            <button
              type="submit"
              disabled={state === "loading" || !email}
              className="bg-[#8c3a1e] text-[#fafaf7] border-0 px-[26px] font-mono uppercase tracking-[0.16em] text-[13px] font-semibold cursor-pointer transition-colors hover:bg-[#14110d] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {state === "loading" ? "Subscribing…" : "Subscribe"}
            </button>
          </form>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6b6557]">
            No spam &middot; {branding.isTenantZero ? "one email a day · " : ""}
            unsubscribe anytime
          </p>
          {state === "error" ? (
            <p className="mt-3 font-mono text-[11px] text-[#8c3a1e]">
              Something went wrong. Please try again.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
