import { useEffect, type ReactElement } from "react";
import { useSearchParams, Navigate, Link } from "react-router-dom";
import { useTenantBranding } from "../context/TenantBrandingContext";

interface StatusContent {
  icon: ReactElement;
  iconTone: "rust" | "muted";
  eyebrow: string;
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

function rustEm(text: string): ReactElement {
  return <em className="italic text-[#8c3a1e]">{text}</em>;
}

function okContent(rating: string | null): StatusContent {
  if (rating === "love") {
    return {
      icon: <CheckIcon />,
      iconTone: "rust",
      eyebrow: "Thank You",
      headline: <>Glad it's {rustEm("landing")}.</>,
      lede: "That's exactly what we hoped to hear. The next edition's already in the works.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  if (rating === "meh") {
    return {
      icon: <CheckIcon />,
      iconTone: "muted",
      eyebrow: "Noted",
      headline: <>We'll make it {rustEm("sharper")}.</>,
      lede: "Fair — we'd rather be unmissable than fine. If one thing would make it a must-read, just reply to the email and tell us.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  if (rating === "nah") {
    return {
      icon: <CheckIcon />,
      iconTone: "muted",
      eyebrow: "Noted",
      headline: <>Thanks for the {rustEm("honesty")}.</>,
      lede: "That's genuinely useful to know. If you've got a moment, a quick reply telling us what missed helps us more than you'd think.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  return {
    icon: <CheckIcon />,
    iconTone: "rust",
    eyebrow: "Thank You",
    headline: <>Thanks for the {rustEm("feedback")}.</>,
    lede: "We read every response ourselves — it goes straight to the people building this.",
    cta: { label: "Browse archive →", to: "/" },
  };
}

function getContent(status: string, rating: string | null): StatusContent | null {
  if (status === "ok") {
    return okContent(rating);
  }
  if (status === "expired") {
    return {
      icon: <ExpiredIcon />,
      iconTone: "muted",
      eyebrow: "Link Expired",
      headline: <>This feedback link has {rustEm("expired")}.</>,
      lede: "No worries — the campaign window has closed. Thanks for reading.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  if (status === "invalid") {
    return {
      icon: <InvalidIcon />,
      iconTone: "muted",
      eyebrow: "Link Invalid",
      headline: <>This link doesn't {rustEm("resolve")}.</>,
      lede: "The URL may have been edited in transit. Try tapping the emoji in the email again.",
      cta: { label: "Browse archive →", to: "/" },
    };
  }
  return null;
}

export function FeedbackPage(): ReactElement {
  const branding = useTenantBranding();
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const rating = searchParams.get("v");

  useEffect(() => {
    document.title = `Feedback — ${branding.name}`;
  }, [status, branding.name]);

  const content = getContent(status, rating);
  if (!content) {
    return <Navigate to="/" replace />;
  }

  return <StatusCard content={content} />;
}

function StatusCard({ content }: { content: StatusContent }): ReactElement {
  const iconColor =
    content.iconTone === "rust" ? "text-[#8c3a1e]" : "text-[#6b6557]";

  return (
    <main className="min-h-[calc(100vh-8rem)] mx-auto max-w-[720px] px-4 sm:px-6 md:px-8 py-20 sm:py-24">
      <article className="rounded-xl border border-[#e7e2d6] bg-white px-6 py-12 sm:px-12 sm:py-16 text-center">
        <div
          className={`mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#d4ceba] bg-[#fbfaf7] ${iconColor}`}
        >
          {content.icon}
        </div>
        <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#8c3a1e]">
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
