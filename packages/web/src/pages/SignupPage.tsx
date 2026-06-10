import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { signup, EmailInUseError } from "@/api/auth";
import { useBrand } from "@/context/TenantBrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SignupForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function SignupPage(): ReactElement {
  const navigate = useNavigate();
  const brand = useBrand();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignupForm>({
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: SignupForm) => signup(values),
    onSuccess: () => {
      void navigate("/onboarding");
    },
    onError: (err: unknown) => {
      if (err instanceof EmailInUseError) {
        setError("email", { message: "That email is already registered." });
      } else {
        setFormError("Something went wrong. Try again.");
      }
    },
  });

  function onSubmit(values: SignupForm): void {
    setFormError(null);
    if (values.password !== values.confirmPassword) {
      setError("confirmPassword", { message: "Passwords don't match." });
      return;
    }
    mutation.mutate(values);
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      <aside className="hidden md:flex flex-col justify-between bg-foreground text-background px-12 py-14">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.12em]">
          {brand.name}
        </span>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-background/55">
            Run your own newsletter
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium leading-tight">
            Curate the day's signal. Send it before coffee.
          </h1>
          <p className="mt-4 max-w-[40ch] text-background/70">
            Sign up, point it at your sources, and review a ranked digest every
            morning — no infrastructure to run.
          </p>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-background/55">
          01 Account → 02 Brand → 03 Sources → 04 Go live
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 sm:px-6 md:px-8 py-10">
        <div className="w-full" style={{ maxWidth: "380px" }}>
          <div className="text-center mb-6">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Create account
            </p>
            <h2 className="mt-1 font-serif text-2xl font-medium">
              Start your newsletter
            </h2>
          </div>

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
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                aria-invalid={errors.name ? true : undefined}
                {...register("name", { required: "Name is required." })}
              />
              {errors.name?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Work email</Label>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  aria-invalid={errors.password ? true : undefined}
                  {...register("password", {
                    required: "Password is required.",
                    minLength: {
                      value: 10,
                      message: "At least 10 characters.",
                    },
                  })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword">Confirm</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  aria-invalid={errors.confirmPassword ? true : undefined}
                  {...register("confirmPassword", {
                    required: "Confirm your password.",
                  })}
                />
              </div>
            </div>
            {(errors.password?.message ?? errors.confirmPassword?.message) && (
              <p role="alert" className="text-sm text-destructive">
                {errors.password?.message ?? errors.confirmPassword?.message}
              </p>
            )}

            <Button
              type="submit"
              disabled={mutation.isPending}
              className="min-h-[44px] px-4"
            >
              {mutation.isPending ? "Creating account…" : "Create account →"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              You'll head straight into setup. No email verification needed.
            </p>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
