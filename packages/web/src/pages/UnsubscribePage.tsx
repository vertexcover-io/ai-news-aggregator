import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";

export function UnsubscribePage(): ReactElement {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");

  useEffect(() => {
    document.title = "Unsubscribed — AI Newsletter";
  }, []);

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
          Unsubscribed
        </p>
        {status === "success" ? (
          <>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
              You've been unsubscribed.
            </h1>
            <p className="mt-4 font-serif text-neutral-700">
              You won't receive any more newsletters.
            </p>
          </>
        ) : (
          <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900">
            You've been unsubscribed.
          </h1>
        )}
      </div>
    </main>
  );
}
