import { useEffect, type ReactElement } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Masthead } from "../components/shell/Masthead";
import { Footer } from "../components/shell/Footer";
import { DirectoryNav } from "../components/shell/DirectoryNav";

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

  const showDirectoryNav = pathname !== "/";

  return (
    <div className="min-h-screen bg-[#fafaf7] text-[#14110d]">
      <div className="max-w-[960px] mx-auto px-4 sm:px-6 md:px-8 pt-7 pb-18">
        <Masthead />
        {showDirectoryNav ? (
          <>
            <hr className="border-0 border-t border-[#e7e2d6] m-0" />
            <DirectoryNav />
            <hr className="border-0 border-t border-[#e7e2d6] m-0" />
          </>
        ) : null}
        <Outlet />
        <Footer />
      </div>
    </div>
  );
}
