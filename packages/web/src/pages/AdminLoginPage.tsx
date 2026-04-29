import { useEffect, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, LoginFailedError } from "@/api/admin";
import { useAdminSession } from "@/hooks/useAdminSession";
import { Button } from "@/components/ui/button";

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
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useAdminSession();

  useEffect(() => {
    if (session.data) {
      void navigate(resolveNext(location.search), { replace: true });
    }
  }, [session.data, location.search, navigate]);

  const mutation = useMutation({
    mutationFn: (pwd: string) => login({ password: pwd }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
      void navigate(resolveNext(location.search));
    },
    onError: (err: unknown) => {
      if (err instanceof LoginFailedError) {
        setError("Incorrect password.");
      } else {
        setError("Something went wrong. Try again.");
      }
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate(password);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(360px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">Admin</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
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
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <Link
          to="/"
          className="inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to archive
        </Link>
      </div>
    </div>
  );
}
