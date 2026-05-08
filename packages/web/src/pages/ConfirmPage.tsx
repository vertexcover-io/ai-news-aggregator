import { useEffect, type ReactElement } from "react";
import { useSearchParams, Navigate, Link } from "react-router-dom";
import { markSubscribed } from "../lib/subscriptionStorage";

interface StatusContent {
  icon: ReactElement;
  iconTone: "rust" | "muted";
  eyebrow: string;
  eyebrowTone: "rust" | "muted";
  headline: ReactElement;
  lede: string;
  cta: { label: string; to: string };
}

function CheckIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ExpiredIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.25 2" />
    </svg>
  );
}

function InvalidIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.25 9a2.75 2.75 0 015.5 0c0 1.5-1.5 2-2.5 2.75-.5.4-.5 1-.5 1.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function getContent(status: string): StatusContent | null {
  if (status === "success") {
    return {
      icon: <CheckIcon />,
      iconTone: "rust",
      eyebrow: "Confirmed",
      eyebrowTone: "rust",
      headline: (
        <>
          You're <em className="italic text-[#8c3a1e]">subscribed</em>.
        </>
      ),
      lede: "The next edition lands tomorrow morning. Until then, the archive's open.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  if (status === "expired") {
    return {
      icon: <ExpiredIcon />,
      iconTone: "muted",
      eyebrow: "Link Expired",
      eyebrowTone: "rust",
      headline: (
        <>
          This confirmation link has{" "}
          <em className="italic text-[#8c3a1e]">expired</em>.
        </>
      ),
      lede: "Confirmation links live for 24 hours. Subscribe again and we'll send a fresh one.",
      cta: { label: "Subscribe again →", to: "/#subscribe" },
    };
  }
  if (status === "invalid") {
    return {
      icon: <InvalidIcon />,
      iconTone: "muted",
      eyebrow: "Link Invalid",
      eyebrowTone: "rust",
      headline: (
        <>
          This link doesn't{" "}
          <em className="italic text-[#8c3a1e]">resolve</em>.
        </>
      ),
      lede: "Either the token's already been used, or the URL was edited in transit. Subscribe again to get a new one.",
      cta: { label: "Subscribe again →", to: "/#subscribe" },
    };
  }
  return null;
}

export function ConfirmPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";

  useEffect(() => {
    document.title = "Confirm Subscription — AI Newsletter";
    if (status === "success") {
      markSubscribed();
    }
  }, [status]);

  const content = getContent(status);
  if (!content) {
    return <Navigate to="/" replace />;
  }

  return <StatusCard content={content} />;
}

function StatusCard({ content }: { content: StatusContent }): ReactElement {
  const iconColor =
    content.iconTone === "rust" ? "text-[#8c3a1e]" : "text-[#6b6557]";
  const eyebrowColor =
    content.eyebrowTone === "rust" ? "text-[#8c3a1e]" : "text-[#6b6557]";

  return (
    <main className="min-h-[calc(100vh-8rem)] mx-auto max-w-[720px] px-4 sm:px-6 md:px-8 py-20 sm:py-24">
      <article className="rounded-xl border border-[#e7e2d6] bg-white px-6 py-12 sm:px-12 sm:py-16 text-center">
        <div
          className={`mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#d4ceba] bg-[#fbfaf7] ${iconColor}`}
        >
          {content.icon}
        </div>
        <p
          className={`mb-3.5 font-mono text-[11px] uppercase tracking-[0.22em] ${eyebrowColor}`}
        >
          {content.eyebrow}
        </p>
        <h1 className="mb-3.5 font-serif text-[28px] sm:text-[36px] font-medium leading-[1.1] tracking-[-0.008em] text-[#14110d]">
          {content.headline}
        </h1>
        <p className="mx-auto mb-7 max-w-[44ch] font-serif text-[17px] leading-[1.55] text-[#2a261f]">
          {content.lede}
        </p>
        <Link
          to={content.cta.to}
          className="inline-block rounded-full border border-[#14110d] bg-[#14110d] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#fbfaf7] transition-colors hover:border-[#8c3a1e] hover:bg-[#8c3a1e]"
        >
          {content.cta.label}
        </Link>
      </article>
    </main>
  );
}
