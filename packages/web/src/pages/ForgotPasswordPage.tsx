import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";

export function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: (e: string) => forgotPassword({ email: e }),
    onSuccess: () => {
      setSent(true);
    },
  });

  function handleSubmit(e: React.BaseSyntheticEvent): void {
    e.preventDefault();
    mutation.mutate(email);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4 text-center"
          style={{ width: "min(360px, 100%)" }}
        >
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, we have sent a reset link.
          </p>
          <Link
            to="/admin/login"
            className="text-sm text-foreground underline min-h-[44px] inline-flex items-center justify-center"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4"
        style={{ width: "min(360px, 100%)" }}
      >
        <h1 className="text-xl font-semibold text-center">Reset password</h1>
        <p className="text-sm text-muted-foreground text-center">
          Enter your email and we will send you a reset link.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 min-h-[44px] rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending} className="min-h-[44px] px-4">
            {mutation.isPending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
        <Link
          to="/admin/login"
          className="inline-flex items-center justify-center min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to sign in
        </Link>
      </div>
    </div>
  );
}
