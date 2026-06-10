import { useState, type ReactElement } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { resetPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";

export function ResetPasswordPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (data: {
      token: string;
      password: string;
      confirmPassword: string;
    }) => resetPassword(data),
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => {
        void navigate("/admin/login");
      }, 3000);
    },
    onError: () => {
      setError("This reset link is invalid or has expired.");
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    mutation.mutate({ token, password, confirmPassword });
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4 text-center"
          style={{ width: "min(360px, 100%)" }}
        >
          <h1 className="text-xl font-semibold">Invalid reset link</h1>
          <p className="text-sm text-muted-foreground">
            This reset link is missing or malformed. Please request a new one.
          </p>
          <Link
            to="/admin/forgot-password"
            className="text-sm text-foreground underline min-h-[44px] inline-flex items-center justify-center"
          >
            Request new reset link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4 text-center"
          style={{ width: "min(360px, 100%)" }}
        >
          <h1 className="text-xl font-semibold">Password reset</h1>
          <p className="text-sm text-muted-foreground">
            Your password has been reset. Redirecting to sign in...
          </p>
          <Link
            to="/admin/login"
            className="text-sm text-foreground underline min-h-[44px] inline-flex items-center justify-center"
          >
            Sign in now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(360px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">Set new password</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              autoFocus
              minLength={8}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className="h-11 min-h-[44px] rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (error) setError(null);
              }}
              className="h-11 min-h-[44px] rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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
          <Button type="submit" disabled={mutation.isPending} className="min-h-[44px] px-4">
            {mutation.isPending ? "Resetting…" : "Reset password"}
          </Button>
        </form>
        <Link
          to="/admin/login"
          className="inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to sign in
        </Link>
      </div>
    </div>
  );
}
