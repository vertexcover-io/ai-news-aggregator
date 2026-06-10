import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  signup,
  EmailInUseError,
  FieldValidationError,
} from "@/api/auth";
import { Button } from "@/components/ui/button";

const INPUT_CLASS =
  "h-11 min-h-[44px] rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function SignupPage(): ReactElement {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => signup({ name, email, password, confirmPassword }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate("/admin/onboarding");
    },
    onError: (err: unknown) => {
      if (err instanceof EmailInUseError) {
        setError("That email is already in use. Try signing in instead.");
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(400px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">
          Start your newsletter
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Your name
            </label>
            <input
              id="name"
              type="text"
              required
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
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
            {mutation.isPending ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/admin/login"
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
