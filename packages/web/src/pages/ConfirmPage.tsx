import { useEffect, type ReactElement } from "react";
import { useSearchParams, Navigate } from "react-router-dom";

export function ConfirmPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");

  useEffect(() => {
    document.title = "Confirm Subscription — AI Newsletter";
  }, []);

  if (!status) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-12">
        {status === "success" && (
          <>
            <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
              Confirmed
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
              You're subscribed! 🎉
            </h1>
            <p className="mt-4 font-serif text-neutral-700">
              You'll receive the AI Newsletter in your inbox.
            </p>
          </>
        )}
        {status === "expired" && (
          <>
            <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
              Link Expired
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
              This confirmation link has expired.
            </h1>
            <p className="mt-4 font-serif text-neutral-700">
              Please subscribe again to receive a new confirmation email.
            </p>
          </>
        )}
        {status === "invalid" && (
          <>
            <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
              Invalid Link
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
              This link is invalid.
            </h1>
          </>
        )}
        {status !== "success" && status !== "expired" && status !== "invalid" && (
          <Navigate to="/" replace />
        )}
      </div>
    </main>
  );
}
