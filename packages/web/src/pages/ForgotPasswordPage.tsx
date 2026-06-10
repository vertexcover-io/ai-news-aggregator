import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(380px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">Reset password</h1>
        {mutation.isSuccess ? (
          <p className="text-sm text-muted-foreground" role="status">
            If an account exists for that email, a reset link is on its way.
            It expires in 30 minutes.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
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
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="min-h-[44px] px-4"
            >
              {mutation.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
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
