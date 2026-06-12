import { useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  resetPassword,
  InvalidResetTokenError,
  FieldValidationError,
} from "@/api/auth";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/AuthCard";
import {
  authInputClass,
  FieldLabel,
  FormError,
} from "@/components/auth/fields";
import { cn } from "@/lib/utils";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => resetPassword({ token, password, confirmPassword }),
    onSuccess: () => {
      void navigate("/admin/login");
    },
    onError: (err: unknown) => {
      if (err instanceof InvalidResetTokenError) {
        setError(
          "This reset link is invalid or has expired. Request a new one.",
        );
      } else if (err instanceof FieldValidationError) {
        const firstField = Object.values(err.fieldErrors).find(
          (messages) => messages.length > 0,
        );
        setError(
          firstField ? firstField[0] : "Please check the form and try again.",
        );
      } else {
        setError("Something went wrong. Try again.");
      }
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    mutation.mutate();
  }

  if (!token) {
    return (
      <AuthCard kicker="Choose a new password" heading="Set your password">
        <p className="text-sm text-danger" role="alert">
          This reset link is missing its token. Request a new one.
        </p>
        <Link
          to="/forgot-password"
          className="mt-4 inline-flex min-h-[44px] items-center justify-center px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-rust hover:text-rust-deep"
        >
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  const meetsLength = password.length >= MIN_PASSWORD_LENGTH;

  return (
    <AuthCard kicker="Choose a new password" heading="Set your password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <input
            id="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoFocus
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            className={authInputClass}
          />
          <p
            className={cn(
              "font-mono text-[11px] tracking-[0.02em]",
              meetsLength ? "text-ok" : "text-mute",
            )}
          >
            {meetsLength ? "✓" : "•"} At least {MIN_PASSWORD_LENGTH} characters
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <input
            id="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (error) setError(null);
            }}
            className={authInputClass}
          />
        </div>
        {error !== null && <FormError>{error}</FormError>}
        <Button
          type="submit"
          variant="rust"
          disabled={mutation.isPending}
          className="min-h-[44px] px-4 py-3"
        >
          {mutation.isPending ? "Saving…" : "Set new password"}
        </Button>
      </form>
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
