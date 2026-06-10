import type { ReactElement } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { setMeta } from "../lib/meta";
import { useTenantBranding } from "../context/TenantBrandingContext";

export function NotFoundPage(): ReactElement {
  const branding = useTenantBranding();

  useEffect(() => {
    document.title = `Not found — ${branding.name}`;
    setMeta("description", "The page you were looking for isn't here.");
  }, [branding.name]);

  return (
    <main className="mx-auto max-w-[680px] px-4 sm:px-6 md:px-8 py-24 text-center">
      <div className="font-mono uppercase text-[11.5px] tracking-[0.22em] text-[#8c3a1e] mb-6">
        404 · NOT FOUND
      </div>
      <h1 className="m-0 mb-6 font-serif font-medium text-[#14110d] text-[clamp(56px,9vw,96px)] leading-[1.0] tracking-[-0.02em]">
        Off the loop.
      </h1>
      <p className="m-0 mb-10 mx-auto max-w-[44ch] font-serif italic text-[20px] leading-[1.55] text-[#6b6557]">
        The page you were looking for isn&apos;t here. Either we never wrote it,
        or we wrote it and took it down. Either way, here&apos;s the way back.
      </p>

      <hr className="border-0 border-t border-[#e7e2d6] m-0 mb-10 mx-auto w-16" />

      <nav
        aria-label="Where to next"
        className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8"
      >
        <Link
          to="/"
          className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#8c3a1e] hover:text-[#14110d] border-b border-[#8c3a1e] pb-[2px]"
        >
          Today&apos;s issue →
        </Link>
        <Link
          to="/must-read"
          className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#6b6557] hover:text-[#14110d]"
        >
          The canon →
        </Link>
        <Link
          to="/built"
          className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#6b6557] hover:text-[#14110d]"
        >
          How it&apos;s built →
        </Link>
      </nav>
    </main>
  );
}
