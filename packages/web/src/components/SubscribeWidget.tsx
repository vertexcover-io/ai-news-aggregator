import { useState, type ReactElement, type ChangeEvent, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { postSubscribe } from "../api/subscribe.js";
import { useIsSubscribed } from "../hooks/useIsSubscribed.js";
import { markSubscribed } from "../lib/subscriptionStorage.js";
import { captureBrowserEvent } from "../lib/analytics.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

type State = "idle" | "loading" | "success" | "error";

export function SubscribeWidget({ className }: { className?: string }): ReactElement | null {
  const [state, setState] = useState<State>("idle");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const isSubscribed = useIsSubscribed();

  if (isSubscribed && state !== "success") return null;

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!email || !agreed) return;
    setState("loading");
    captureBrowserEvent("subscribe_form_submitted", { source: "widget" });
    void postSubscribe(email).then((result) => {
      if ("error" in result) {
        captureBrowserEvent("subscribe_form_failed", {
          source: "widget",
          error_code: result.error,
        });
        setState("error");
      } else {
        captureBrowserEvent("subscribe_form_succeeded", { source: "widget" });
        setState("success");
        markSubscribed();
      }
    });
  };

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value);
  };

  const handleAgreedChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setAgreed(e.target.checked);
  };

  if (state === "success") {
    return (
      <div className={className}>
        <p className="font-serif text-neutral-700">
          Check your inbox to confirm your subscription.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">
        Newsletter
      </p>
      <h3 className="font-serif text-xl text-neutral-900 mb-4">
        Get the daily AI digest in your inbox
      </h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          type="email"
          placeholder="Your email"
          value={email}
          onChange={handleEmailChange}
          required
          disabled={state === "loading"}
        />
        <label className="flex items-start gap-2 text-sm text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={handleAgreedChange}
            required
            className="mt-0.5 accent-[#8C3A1E]"
          />
          <span>
            I agree to the{" "}
            <Link to="/privacy" className="underline hover:text-neutral-900">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/terms" className="underline hover:text-neutral-900">
              Terms of Service
            </Link>
          </span>
        </label>
        <Button
          type="submit"
          disabled={state === "loading" || !agreed}
          className="bg-[#8C3A1E] text-white hover:bg-[#7a3319] self-start px-6"
        >
          {state === "loading" ? "Subscribing…" : "Subscribe"}
        </Button>
        {state === "error" && (
          <p className="text-sm text-red-600">
            Something went wrong. Please try again.
          </p>
        )}
      </form>
    </div>
  );
}
