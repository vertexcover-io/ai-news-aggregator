import { useEffect, type ReactElement } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Masthead } from "../components/shell/Masthead";
import { Footer } from "../components/shell/Footer";

export function PublicLayout(): ReactElement {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash !== "#subscribe") return undefined;
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
  }, [pathname, hash]);

  return (
    <div className="min-h-screen bg-[#fafaf7] text-[#14110d]">
      <div className="max-w-[960px] mx-auto px-4 sm:px-6 md:px-8 pt-7 pb-18">
        <Masthead />
        <Outlet />
        <Footer />
      </div>
    </div>
  );
}
