import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/AuthCard";
import {
  authInputClass,
  FieldLabel,
  FormError,
  Help,
} from "@/components/auth/fields";

export function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => forgotPassword(email),
    onError: () => {
      setError("Something went wrong. Try again.");
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <AuthCard kicker="Password reset" heading="Forgot your password?">
      {mutation.isSuccess ? (
        <p
          className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute"
          role="status"
        >
          <span
            aria-hidden
            className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-ok"
          />
          If an account exists for that email, a reset link is on its way. It
          expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
          <Help>
            Enter the email on your account and we’ll send a reset link.
          </Help>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="ada@studio.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className={authInputClass}
            />
          </div>
          {error !== null && <FormError>{error}</FormError>}
          <Button
            type="submit"
            variant="ink"
            disabled={mutation.isPending}
            className="min-h-[44px] px-4 py-3"
          >
            {mutation.isPending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <hr className="my-[22px] border-0 border-t border-line" />
      <Link
        to="/admin/login"
        className="inline-flex min-h-[44px] items-center justify-center px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-mute hover:text-ink"
      >
        ← Back to sign in
      </Link>
    </AuthCard>
  );
}
