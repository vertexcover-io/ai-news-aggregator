import { useEffect, type ReactElement } from "react";

export function PrivacyPolicyPage(): ReactElement {
  useEffect(() => {
    document.title = "Privacy Policy — AI Newsletter";
  }, []);

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
          Legal
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-medium text-neutral-900 mb-8">
          Privacy Policy
        </h1>

        <div className="space-y-8 font-serif text-neutral-800 leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              What data we collect
            </h2>
            <p>
              When you subscribe to the AI Newsletter, we collect your email
              address. We use this solely to send you the newsletter digest. We
              do not collect any other personal information. We may also use
              PostHog analytics to understand page visits, archive reads, share
              clicks, and subscription form outcomes.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              How we use it
            </h2>
            <p>
              Your email address is used exclusively to deliver the daily AI
              Newsletter digest to your inbox. We do not sell, share, or
              otherwise distribute your email address to any third parties.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              How to unsubscribe
            </h2>
            <p>
              Every newsletter issue includes an unsubscribe link at the bottom.
              Clicking it will immediately remove your email address from our
              list. You may also contact us directly to request removal.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-medium text-neutral-900 mb-3">
              Contact
            </h2>
            <p>
              If you have questions about your data or this privacy policy,
              please reach out to the Vertexcover team at the email address
              listed on our website.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
