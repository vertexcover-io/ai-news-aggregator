import {
  useState,
  type ChangeEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { Link } from "react-router-dom";
import { postSubscribe } from "../../api/subscribe";
import { useIsSubscribed } from "../../hooks/useIsSubscribed";
import { markSubscribed } from "../../lib/subscriptionStorage";

type Variant = "hero" | "interlude";
type State = "idle" | "loading" | "success" | "error";

interface Props {
  variant?: Variant;
}

export function SubscribeInline({ variant = "hero" }: Props): ReactElement | null {
  const [state, setState] = useState<State>("idle");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const isSubscribed = useIsSubscribed();

  if (isSubscribed && state !== "success") return null;

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!email || !agreed || state === "loading") return;
    setState("loading");
    void postSubscribe(email).then((result) => {
      if ("error" in result) {
        setState("error");
      } else {
        setState("success");
        markSubscribed();
      }
    });
  };

  const onEmail = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value);
  };

  const onAgree = (e: ChangeEvent<HTMLInputElement>): void => {
    setAgreed(e.target.checked);
  };

  if (state === "success") {
    return (
      <div className="text-center">
        <p className="font-serif text-lg italic text-[#2a261f]">
          Check your inbox to confirm your subscription.
        </p>
      </div>
    );
  }

  const isInterlude = variant === "interlude";
  const wrapperClass = isInterlude
    ? "rounded-2xl border border-[#e7e2d6] bg-[#ffffff] px-6 py-8 sm:px-10 sm:py-10 text-center"
    : "text-center";

  return (
    <div className={wrapperClass}>
      {isInterlude ? (
        <>
          <h3 className="font-serif text-2xl italic font-medium leading-tight tracking-tight text-[#14110d]">
            Get the daily AI digest in your inbox.
          </h3>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#6b6557]">
            Free · One email each weekday · Unsubscribe anytime
          </p>
        </>
      ) : null}

      <form
        onSubmit={onSubmit}
        className={`${isInterlude ? "mt-5" : ""} mx-auto flex w-full max-w-[440px] items-center gap-2 rounded-full border border-[#e7e2d6] bg-[#ffffff] py-[6px] pl-[18px] pr-[6px] transition-[border-color,box-shadow] duration-150 focus-within:border-[#14110d] focus-within:shadow-[0_0_0_4px_rgba(20,17,13,0.06)]`}
      >
        <input
          type="email"
          required
          aria-label="Email address"
          placeholder="you@company.com"
          value={email}
          onChange={onEmail}
          disabled={state === "loading"}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14.5px] text-[#14110d] outline-none placeholder:text-[#8a8472]"
        />
        <button
          type="submit"
          disabled={state === "loading" || !email || !agreed}
          className="rounded-full bg-[#14110d] px-[18px] py-[9px] font-sans text-[13.5px] font-medium text-[#fbfaf7] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "loading" ? "Subscribing…" : "Subscribe"}
        </button>
      </form>

      <label className="mx-auto mt-3 flex w-fit max-w-[440px] cursor-pointer items-center justify-center gap-2 text-left font-sans text-[14px] leading-[1.5] text-[#8a8472]">
        <input
          type="checkbox"
          checked={agreed}
          onChange={onAgree}
          required
          className="h-[14px] w-[14px] flex-none accent-[#8c3a1e]"
        />
        <span>
          I agree to the{" "}
          <Link
            to="/privacy"
            className="underline underline-offset-[3px] decoration-current hover:text-[#8c3a1e]"
          >
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link
            to="/terms"
            className="underline underline-offset-[3px] decoration-current hover:text-[#8c3a1e]"
          >
            Terms of Service
          </Link>
        </span>
      </label>

      {!isInterlude ? (
        <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#8a8472]">
          Free · One email each weekday · Unsubscribe anytime
        </p>
      ) : null}

      {state === "error" ? (
        <p className="mt-3 font-mono text-[11px] text-[#8c3a1e]">
          Something went wrong. Please try again.
        </p>
      ) : null}
    </div>
  );
}
