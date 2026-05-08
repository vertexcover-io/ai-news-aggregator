import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";

function MinusIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 12h12" />
    </svg>
  );
}

export function UnsubscribePage(): ReactElement {
  useEffect(() => {
    document.title = "Unsubscribed — AI Newsletter";
  }, []);

  return (
    <main className="min-h-[calc(100vh-8rem)] mx-auto max-w-[720px] px-4 sm:px-6 md:px-8 py-20 sm:py-24">
      <article className="rounded-xl border border-[#e7e2d6] bg-white px-6 py-12 sm:px-12 sm:py-16 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#d4ceba] bg-[#fbfaf7] text-[#6b6557]">
          <MinusIcon />
        </div>
        <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#6b6557]">
          Unsubscribed
        </p>
        <h1 className="mb-3.5 font-serif text-[28px] sm:text-[36px] font-medium leading-[1.1] tracking-[-0.008em] text-[#14110d]">
          You've been{" "}
          <em className="italic text-[#8c3a1e]">unsubscribed</em>.
        </h1>
        <p className="mx-auto mb-7 max-w-[44ch] font-serif text-[17px] leading-[1.55] text-[#2a261f]">
          You won't receive any more newsletters. The archive stays open.
        </p>
        <Link
          to="/"
          className="inline-block rounded-full border border-[#14110d] bg-[#14110d] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#fbfaf7] transition-colors hover:border-[#8c3a1e] hover:bg-[#8c3a1e]"
        >
          Browse archive →
        </Link>
      </article>
    </main>
  );
}
