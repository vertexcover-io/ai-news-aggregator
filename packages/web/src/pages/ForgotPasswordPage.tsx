import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ForgotForm {
  email: string;
}

export function ForgotPasswordPage(): ReactElement {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({ defaultValues: { email: "" } });

  const mutation = useMutation({
    mutationFn: (email: string) => forgotPassword(email),
    onError: () => {
      setFormError("Something went wrong. Try again.");
    },
  });

  function onSubmit(values: ForgotForm): void {
    setFormError(null);
    mutation.mutate(values.email);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 sm:px-6 md:px-8 py-8">
      <div className="w-full" style={{ maxWidth: "400px" }}>
        <div className="text-center mb-6">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Password reset
          </p>
          <h2 className="mt-1 font-serif text-2xl font-medium">
            Forgot your password?
          </h2>
        </div>

        <div className="rounded-lg border bg-card shadow-sm p-6">
          <p className="text-sm text-muted-foreground mb-4">
            Enter the email on your account and we'll send you a reset link.
          </p>

          {mutation.isSuccess ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              If an account exists for that email, a reset link is on its way.
              The link expires in 30 minutes and can be used once.
            </p>
          ) : (
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
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="min-h-[44px] px-4"
              >
                {mutation.isPending ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>

        <div className="text-center mt-5">
          <Link
            to="/login"
            className="inline-flex items-center justify-center min-h-[44px] px-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
          >
            ← Back to log in
          </Link>
        </div>
      </div>
    </div>
  );
}
