import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { resetPassword, InvalidResetTokenError } from "@/api/auth";
import {
  AuthCenterShell,
  cardClass,
  errClass,
  helpClass,
  inputClass,
  inputInvalidClass,
  labelClass,
  primaryBtnClass,
} from "./authShared";

const resetFormSchema = z
  .object({
    password: z.string().min(8, "At least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don’t match.",
    path: ["confirmPassword"],
  });

type ResetFormValues = z.infer<typeof resetFormSchema>;

export function ResetPasswordPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      setDone(true);
    },
    onError: (err: unknown) => {
      if (err instanceof InvalidResetTokenError) {
        setRootError("This reset link is invalid or has expired.");
      } else {
        setRootError("Something went wrong. Try again.");
      }
    },
  });

  const onSubmit = handleSubmit((values) => {
    setRootError(null);
    mutation.mutate({ token, ...values });
  });

  if (done) {
    return (
      <AuthCenterShell kicker="Password reset" heading="Password updated">
        <div className={cardClass}>
          <p className={`${helpClass} m-0 text-[13.5px]`}>
            Your password has been updated. You can now log in with your new
            password.
          </p>
        </div>
        <div className="mt-4 text-center">
          <Link
            to="/login"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8c3a1e] hover:text-[#6e2d17]"
          >
            Go to log in →
          </Link>
        </div>
      </AuthCenterShell>
    );
  }

  return (
    <AuthCenterShell kicker="Choose a new password" heading="Set your password">
      <div className={cardClass}>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
        >
          <div className="mb-4">
            <label className={labelClass} htmlFor="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={`${inputClass}${errors.password ? ` ${inputInvalidClass}` : ""}`}
              {...register("password")}
            />
            {errors.password && (
              <p role="alert" className={errClass}>
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="mb-3.5">
            <label className={labelClass} htmlFor="confirmPassword">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={`${inputClass}${errors.confirmPassword ? ` ${inputInvalidClass}` : ""}`}
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p role="alert" className={errClass}>
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          {rootError !== null && (
            <p role="alert" aria-live="polite" className={`${errClass} mb-3`}>
              {rootError}{" "}
              <Link to="/forgot-password" className="underline">
                Request a new link
              </Link>
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className={primaryBtnClass}
          >
            {mutation.isPending ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
      <p className={`${helpClass} mt-4 text-center`}>
        This reset link is single-use and expires 1 hour after it was sent.
      </p>
    </AuthCenterShell>
  );
}
