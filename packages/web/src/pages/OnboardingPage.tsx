import type { ReactElement } from "react";
import { useSession } from "@/hooks/useSession";

/**
 * Onboarding wizard stub (P3). Signup lands here; the real multi-step wizard
 * arrives in P11. Kept minimal on purpose — it only proves the authenticated
 * post-signup landing.
 */
export function OnboardingPage(): ReactElement {
  const { data } = useSession();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-3 text-center"
        style={{ width: "min(480px, 100%)" }}
      >
        <h1 className="text-xl font-semibold">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          {data
            ? `Welcome, ${data.user.name}. Your newsletter setup wizard is coming soon.`
            : "Your newsletter setup wizard is coming soon."}
        </p>
        <p className="text-sm text-muted-foreground">
          Your tenant is in <strong>pending setup</strong> — nothing runs or
          publishes until setup is complete.
        </p>
      </div>
    </div>
  );
}
