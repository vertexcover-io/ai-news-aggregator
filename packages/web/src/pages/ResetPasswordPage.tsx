import { useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  resetPassword,
  InvalidResetTokenError,
  FieldValidationError,
} from "@/api/auth";
import { Button } from "@/components/ui/button";

const INPUT_CLASS =
  "h-11 min-h-[44px] rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

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
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
          style={{ width: "min(380px, 100%)" }}
        >
          <h1 className="text-xl font-semibold text-center">
            Choose a new password
          </h1>
          <p className="text-sm text-destructive" role="alert">
            This reset link is missing its token. Request a new one.
          </p>
          <Link
            to="/forgot-password"
            className="inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(380px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">
          Choose a new password
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (error) setError(null);
              }}
              className={INPUT_CLASS}
            />
          </div>
          {error !== null && (
            <p
              role="alert"
              aria-live="polite"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="min-h-[44px] px-4"
          >
            {mutation.isPending ? "Saving…" : "Set new password"}
          </Button>
        </form>
        <Link
          to="/admin/login"
          className="inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
