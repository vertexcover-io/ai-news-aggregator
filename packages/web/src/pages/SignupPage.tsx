import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  signup,
  EmailInUseError,
  RateLimitedError,
} from "@/api/auth";
import { BrandMark } from "@/components/shell/BrandMark";
import {
  errClass,
  inputClass,
  inputInvalidClass,
  kickerClass,
  labelClass,
  rustBtnClass,
} from "./authShared";

const signupFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name."),
    email: z.email("Enter a valid email."),
    password: z.string().min(8, "At least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don’t match.",
    path: ["confirmPassword"],
  });

type SignupFormValues = z.infer<typeof signupFormSchema>;

export function SignupPage(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rootError, setRootError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate("/onboarding");
    },
    onError: (err: unknown) => {
      if (err instanceof EmailInUseError) {
        setError("email", { message: "Email already in use." });
      } else if (err instanceof RateLimitedError) {
        setRootError("Too many attempts. Try again in a few minutes.");
      } else {
        setRootError("Something went wrong. Try again.");
      }
    },
  });

  const onSubmit = handleSubmit((values) => {
    setRootError(null);
    mutation.mutate(values);
  });

  return (
    <div className="min-h-screen grid md:grid-cols-[1.05fr_1fr] bg-[#fbfaf7] font-sans text-[#14110d]">
      <aside className="hidden md:flex flex-col justify-between bg-[#14110d] p-14 text-[#fbfaf7]">
        <div className="flex items-center gap-2.5">
          <BrandMark size={26} className="text-[#e98f6e]" />
          <span className="font-mono text-[16px] font-semibold uppercase tracking-[0.12em] text-white">
            AGENTLOOP
          </span>
        </div>

        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#fbfaf7]/55">
            Run your own newsletter
          </p>
          <h1 className="mt-3 font-serif text-[clamp(30px,3.6vw,46px)] font-medium leading-[1.08] tracking-[-0.018em]">
            Curate the day’s signal.{" "}
            <em className="italic text-[#e98f6e]">Send it before coffee.</em>
          </h1>
          <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-[#fbfaf7]/70">
            Sign up, point it at your sources, and review a ranked digest every
            morning — no infrastructure to run.
          </p>
        </div>

        <div className="font-mono text-[11px] uppercase tracking-[0.18em] leading-[2.1] text-[#fbfaf7]/55">
          01 Account <span className="text-[#e98f6e]">→</span> 02 Brand{" "}
          <span className="text-[#e98f6e]">→</span> 03 Sources{" "}
          <span className="text-[#e98f6e]">→</span> 04 Go live
        </div>
      </aside>

      <main className="grid place-items-center px-6 py-10">
        <div className="w-full max-w-[380px]">
          <div className="text-center mb-6">
            <p className={kickerClass}>Create account</p>
            <h2 className="mt-1 font-serif text-[28px] font-medium tracking-[-0.01em]">
              Start your newsletter
            </h2>
          </div>

          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            noValidate
          >
            <div className="mb-4">
              <label className={labelClass} htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Ada Lovelace"
                autoComplete="name"
                className={`${inputClass}${errors.name ? ` ${inputInvalidClass}` : ""}`}
                {...register("name")}
              />
              {errors.name && (
                <p role="alert" className={errClass}>
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className={labelClass} htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                placeholder="ada@studio.com"
                autoComplete="email"
                className={`${inputClass}${errors.email ? ` ${inputInvalidClass}` : ""}`}
                {...register("email")}
              />
              {errors.email && (
                <p role="alert" className={errClass}>
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={`${inputClass}${errors.password ? ` ${inputInvalidClass}` : ""}`}
                    {...register("password")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="confirmPassword">
                    Confirm
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={`${inputClass}${errors.confirmPassword ? ` ${inputInvalidClass}` : ""}`}
                    {...register("confirmPassword")}
                  />
                </div>
              </div>
              {errors.password && (
                <p role="alert" className={errClass}>
                  {errors.password.message}
                </p>
              )}
              {errors.confirmPassword && (
                <p role="alert" className={errClass}>
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            {rootError !== null && (
              <p role="alert" aria-live="polite" className={`${errClass} mb-3`}>
                {rootError}
              </p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className={`${rustBtnClass} mt-1.5`}
            >
              {mutation.isPending ? "Creating account…" : "Create account →"}
            </button>
            <p className={`mt-3 text-center text-[12.5px] text-[#6b6557]`}>
              You’ll head straight into setup. No email verification needed.
            </p>
          </form>

          <p className="mt-5 text-center text-[13px] text-[#6b6557]">
            Already have an account?{" "}
            <Link
              to="/login"
              className="border-b border-[#8c3a1e] text-[#8c3a1e]"
            >
              Log in
            </Link>
          </p>
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-[#6b6557]">
            By creating an account you agree to the{" "}
            <Link to="/terms" className="underline decoration-dotted">
              Terms
            </Link>{" "}
            &{" "}
            <Link to="/privacy" className="underline decoration-dotted">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
