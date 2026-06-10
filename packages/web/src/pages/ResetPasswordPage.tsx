import { useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { resetPassword, InvalidResetTokenError } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ResetForm {
  password: string;
  confirmPassword: string;
}

export function ResetPasswordPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetForm>({
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: (input: ResetForm & { token: string }) => resetPassword(input),
    onSuccess: () => {
      void navigate("/admin");
    },
    onError: (err: unknown) => {
      if (err instanceof InvalidResetTokenError) {
        setFormError(
          "This reset link is invalid or has expired. Request a new one.",
        );
      } else {
        setFormError("Something went wrong. Try again.");
      }
    },
  });

  function onSubmit(values: ResetForm): void {
    setFormError(null);
    if (values.password !== values.confirmPassword) {
      setError("confirmPassword", { message: "Passwords don't match." });
      return;
    }
    mutation.mutate({ token, ...values });
  }

  if (token === "") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4 sm:px-6 md:px-8 py-8">
        <div className="w-full text-center" style={{ maxWidth: "400px" }}>
          <h2 className="font-serif text-2xl font-medium">Invalid reset link</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            This password reset link is missing its token.
          </p>
          <Link
            to="/forgot"
            className="mt-5 inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-primary hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 sm:px-6 md:px-8 py-8">
      <div className="w-full" style={{ maxWidth: "400px" }}>
        <div className="text-center mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Choose a new password
          </p>
          <h2 className="mt-1 font-serif text-2xl font-medium">
            Set your password
          </h2>
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
              <Label htmlFor="password">New password</Label>
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
              {errors.password?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
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
              {errors.confirmPassword?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="min-h-[44px] px-4"
            >
              {mutation.isPending
                ? "Updating…"
                : "Update password & sign in"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          This reset link is single-use and expires 30 minutes after it was
          sent.
        </p>
      </div>
    </div>
  );
}
