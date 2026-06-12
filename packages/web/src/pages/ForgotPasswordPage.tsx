import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { forgotPassword, RateLimitedError } from "@/api/auth";
import {
  AuthCenterShell,
  cardClass,
  errClass,
  helpClass,
  inputClass,
  labelClass,
  primaryBtnClass,
} from "./authShared";

export function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: forgotPassword,
    onSuccess: () => {
      setSent(true);
    },
    onError: (err: unknown) => {
      if (err instanceof RateLimitedError) {
        setError("Too many attempts. Try again in a few minutes.");
      } else {
        setError("Something went wrong. Try again.");
      }
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate({ email });
  }

  return (
    <AuthCenterShell kicker="Password reset" heading="Forgot your password?">
      <div className={cardClass}>
        <p className={`${helpClass} mb-4 text-[13.5px]`}>
          Enter the email on your account and we’ll send you a reset link.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-3.5">
            <label className={labelClass} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              placeholder="ada@studio.com"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className={inputClass}
            />
          </div>

          {error !== null && (
            <p role="alert" aria-live="polite" className={`${errClass} mb-3`}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className={primaryBtnClass}
          >
            {mutation.isPending ? "Sending…" : "Send reset link"}
          </button>
        </form>

        {sent && (
          <>
            <hr className="my-5 border-0 border-t border-[#e7e2d6]" />
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-[#2f6f3e]"
              />
              <p role="status" className={`${helpClass} m-0`}>
                If an account exists for that email, a reset link is on its
                way. The link expires in 1 hour and can be used once.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 text-center">
        <Link
          to="/login"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6b6557] hover:text-[#14110d]"
        >
          ← Back to log in
        </Link>
      </div>
    </AuthCenterShell>
  );
}
