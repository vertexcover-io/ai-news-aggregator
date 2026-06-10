import { useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { login, InvalidCredentialsError } from "@/api/auth";
import { useBrand } from "@/context/TenantBrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginForm {
  email: string;
  password: string;
}

function resolveNext(search: string): string {
  const raw = new URLSearchParams(search).get("next");
  if (!raw) return "/admin";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "/admin";
  }
}

export function TenantLoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const brand = useBrand();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ defaultValues: { email: "", password: "" } });

  const mutation = useMutation({
    mutationFn: (values: LoginForm) => login(values),
    onSuccess: () => {
      void navigate(resolveNext(location.search));
    },
    onError: (err: unknown) => {
      if (err instanceof InvalidCredentialsError) {
        setFormError("Incorrect email or password.");
      } else {
        setFormError("Something went wrong. Try again.");
      }
    },
  });

  function onSubmit(values: LoginForm): void {
    setFormError(null);
    mutation.mutate(values);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 sm:px-6 md:px-8 py-8">
      <div className="w-full" style={{ maxWidth: "380px" }}>
        <div className="text-center mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {brand.name}
          </p>
          <h2 className="mt-1 font-serif text-2xl font-medium">Log in</h2>
        </div>

        <div className="rounded-lg border bg-card shadow-sm p-6">
          <form
            onSubmit={(e) => void handleSubmit(onSubmit)(e)}
            className="flex flex-col gap-4"
          >
            {formError !== null && (
              <p role="alert" aria-live="polite" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="ada@studio.com"
                aria-invalid={errors.email ? true : undefined}
                {...register("email", { required: "Email is required." })}
              />
              {errors.email?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Forgot?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={errors.password ? true : undefined}
                {...register("password", { required: "Password is required." })}
              />
              {errors.password?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="min-h-[44px] px-4"
            >
              {mutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/signup" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
