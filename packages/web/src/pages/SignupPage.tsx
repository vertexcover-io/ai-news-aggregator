import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  signup,
  EmailInUseError,
  FieldValidationError,
} from "@/api/auth";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthBrandAside } from "@/components/auth/AuthBrandAside";
import {
  authInputClass,
  Kicker,
  FieldLabel,
  FormError,
  Help,
  DisplayHeading,
} from "@/components/auth/fields";

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

  const passwordMismatch = error === "Passwords do not match";

  return (
    <AuthShell
      aside={
        <AuthBrandAside
          kicker="Run your own newsletter"
          headline="Curate the day’s signal."
          accent="Send it before coffee."
          lede="Sign up, point it at your sources, and review a ranked digest every morning — no infrastructure to run."
          steps={["01 Account", "02 Brand", "03 Sources", "04 Go live"]}
        />
      }
    >
      <div className="mb-6 text-center">
        <Kicker tone="rust">Create account</Kicker>
        <DisplayHeading className="mt-1">Start your newsletter</DisplayHeading>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <input
            id="name"
            type="text"
            required
            autoFocus
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className={authInputClass}
          />
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <input
            id="email"
            type="email"
            required
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

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                aria-invalid={passwordMismatch}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                className={authInputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="confirmPassword">Confirm</FieldLabel>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                aria-label="Confirm password"
                aria-invalid={passwordMismatch}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError(null);
                }}
                className={authInputClass}
              />
            </div>
          </div>
          {error !== null && <FormError>{error}</FormError>}
        </div>

        <Button
          type="submit"
          variant="rust"
          disabled={mutation.isPending}
          className="min-h-[44px] px-4 py-3"
        >
          {mutation.isPending ? "Creating account…" : "Create account →"}
        </Button>
        <Help className="text-center">
          You’ll head straight into setup. No email verification needed.
        </Help>
      </form>

      <p className="mt-[22px] text-center text-[13px] text-mute">
        Already have an account?{" "}
        <Link
          to="/admin/login"
          className="border-b border-rust text-rust hover:text-rust-deep"
        >
          Log in
        </Link>
      </p>
      <p className="mt-[18px] text-center text-[11.5px] leading-relaxed text-mute">
        By creating an account you agree to the Terms &amp; Privacy Policy.
      </p>
    </AuthShell>
  );
}
