import { useEffect, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, LoginFailedError } from "@/api/auth";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthBrandAside } from "@/components/auth/AuthBrandAside";
import {
  authInputClass,
  Kicker,
  FieldLabel,
  FormError,
  DisplayHeading,
} from "@/components/auth/fields";

function resolveNext(search: string): string {
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return "/admin";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "/admin";
  }
}

export function AdminLoginPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSession();

  useEffect(() => {
    if (session.data) {
      void navigate(resolveNext(location.search), { replace: true });
    }
  }, [session.data, location.search, navigate]);

  const mutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate(resolveNext(location.search));
    },
    onError: (err: unknown) => {
      if (err instanceof LoginFailedError) {
        setError("Incorrect email or password.");
      } else {
        setError("Something went wrong. Try again.");
      }
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <AuthShell
      aside={
        <AuthBrandAside
          kicker="Welcome back"
          headline="The day’s signal,"
          accent="ranked before coffee."
          lede="Sign in to review this morning’s digest, tune your sources, and ship to your readers."
          tagline="Curate · Review · Publish"
        />
      }
    >
      <div className="mb-6 text-center">
        <Kicker tone="rust">Sign in</Kicker>
        <DisplayHeading className="mt-1">Sign in</DisplayHeading>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
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
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
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
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between text-[13px]">
        <Link
          to="/forgot-password"
          className="text-mute hover:text-ink"
        >
          Forgot password?
        </Link>
        <Link to="/signup" className="text-rust hover:text-rust-deep">
          Create account
        </Link>
      </div>
      <Link
        to="/"
        className="mt-2 inline-flex min-h-[44px] items-center justify-center px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-mute hover:text-ink"
      >
        ← Back to archive
      </Link>
    </AuthShell>
  );
}
