import { useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { exitImpersonation } from "@/api/super-admin";
import { useImpersonation } from "@/hooks/useImpersonation";

export function ImpersonationBanner(): ReactElement | null {
  const { state, isImpersonating, clear } = useImpersonation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isImpersonating || state === null) return null;

  async function handleExit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await exitImpersonation();
      clear();
      window.location.assign("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to exit");
      setPending(false);
    }
  }

  const label = state.tenantName.trim() || "this tenant";

  return (
    <div
      data-testid="impersonation-banner"
      className="sticky top-0 z-40 flex items-center justify-center gap-4 bg-black px-4 py-2 text-xs font-mono uppercase tracking-wider text-white sm:px-6 md:px-8"
    >
      <span>
        You&apos;re viewing <b className="font-semibold">{label}</b> as super
        admin · changes are audited
      </span>
      {error !== null && (
        <span role="alert" className="text-red-300 normal-case tracking-normal">
          {error}
        </span>
      )}
      <button
        type="button"
        data-testid="impersonation-exit"
        disabled={pending}
        onClick={() => {
          void handleExit();
        }}
        className="inline-flex items-center gap-1 rounded border border-white/40 px-3 py-1 tracking-wide hover:bg-white/10 disabled:opacity-50"
      >
        {pending ? "Exiting…" : "Exit impersonation"}
        <X className="size-3" />
      </button>
    </div>
  );
}
