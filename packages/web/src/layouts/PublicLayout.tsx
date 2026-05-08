import { useEffect, type ReactElement } from "react";
import { Outlet, useLocation } from "react-router-dom";

function Footer(): ReactElement {
  return (
    <footer className="px-4 sm:px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#8a8472]">
      <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="font-medium text-[#14110d] whitespace-nowrap">
          The Daily Read
        </span>
        <span className="text-[#8a8472]">·</span>
        <span className="whitespace-nowrap">
          Made by{" "}
          <a
            href="https://vertexcover.io"
            target="_blank"
            rel="noopener noreferrer"
            className="border-b border-[#e7e2d6] pb-px text-[#6b6557] transition-colors hover:border-[#8c3a1e] hover:text-[#8c3a1e]"
          >
            Vertexcover Labs
          </a>
        </span>
      </span>
    </footer>
  );
}

export function PublicLayout(): ReactElement {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (pathname === "/" && hash === "#subscribe") {
      let cancelled = false;
      const start = Date.now();
      const tick = (): void => {
        if (cancelled) return;
        const target = document.getElementById("subscribe");
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (Date.now() - start < 5000) {
          requestAnimationFrame(tick);
        }
      };
      tick();
      return (): void => {
        cancelled = true;
      };
    }
    return undefined;
  }, [pathname, hash]);

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#14110d]">
      <Outlet />
      <Footer />
    </div>
  );
}
