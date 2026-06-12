import { useEffect, useState, type ReactElement } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  login,
  LoginFailedError,
  RateLimitedError,
} from "@/api/auth";
import { useSession } from "@/hooks/useSession";
import {
  AuthCenterShell,
  cardClass,
  errClass,
  inputClass,
  labelClass,
  primaryBtnClass,
} from "./authShared";

function resolveNext(search: string): string {
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return "/admin";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "/admin";
  }
}

// Old bookmarks: /admin/login lives on as a redirect to /login (preserving ?next=).
export function AdminLoginRedirect(): ReactElement {
  const { search } = useLocation();
  return <Navigate to={`/login${search}`} replace />;
}

export function LoginPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSession();

  useEffect(() => {
    if (session.user) {
      void navigate(resolveNext(location.search), { replace: true });
    }
  }, [session.user, location.search, navigate]);

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate(resolveNext(location.search));
    },
    onError: (err: unknown) => {
      if (err instanceof LoginFailedError) {
        setError("Incorrect email or password.");
      } else if (err instanceof RateLimitedError) {
        setError("Too many attempts. Try again in a few minutes.");
      } else {
        setError("Something went wrong. Try again.");
      }
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate({ email, password });
  }

  return (
    <AuthCenterShell kicker="Welcome back" heading="Log in">
      <div className={cardClass}>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
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
                if (error) setError(null);
              }}
              className={inputClass}
            />
          </div>

          <div className="mb-4">
            <div className="flex items-baseline justify-between">
              <label className={labelClass} htmlFor="password">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6b6557] hover:text-[#14110d]"
              >
                Forgot?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              required
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
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
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[13px] text-[#6b6557]">
        New here?{" "}
        <Link to="/signup" className="border-b border-[#8c3a1e] text-[#8c3a1e]">
          Create an account
        </Link>
      </p>
      <div className="mt-4 text-center">
        <Link
          to="/"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6b6557] hover:text-[#14110d]"
        >
          ← Back to archive
        </Link>
      </div>
    </AuthCenterShell>
  );
}
