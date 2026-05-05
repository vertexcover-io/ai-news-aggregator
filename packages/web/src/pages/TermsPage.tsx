import { useEffect, type ReactElement } from "react";

export function TermsPage(): ReactElement {
  useEffect(() => {
    document.title = "Terms of Service — AI Newsletter";
  }, []);

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
          Legal
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900 mb-8">
          Terms of Service
        </h1>

        <div className="space-y-8 font-serif text-neutral-800 leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              Subscription terms
            </h2>
            <p>
              By subscribing to the AI Newsletter, you agree to receive periodic
              email digests curated by the Vertexcover team. Subscription is
              free and you may unsubscribe at any time.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              Newsletter content
            </h2>
            <p>
              The AI Newsletter is a curated digest of publicly available
              information about artificial intelligence. All linked content
              remains the property of its original authors. We make no claim of
              ownership over third-party articles, posts, or publications
              referenced in the digest.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              Unsubscribe
            </h2>
            <p>
              You may unsubscribe from the newsletter at any time by clicking
              the unsubscribe link included in every issue. Upon unsubscribing,
              your email address will be removed from our mailing list promptly.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              No warranties
            </h2>
            <p>
              The AI Newsletter is provided as-is without any warranties of any
              kind. The Vertexcover team makes no guarantees regarding delivery
              frequency, content accuracy, or continued availability of the
              service.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
