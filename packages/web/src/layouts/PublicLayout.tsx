import { useEffect, type MouseEvent, type ReactElement } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

function Nav(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

  const handleSubscribeClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (location.pathname === "/") {
      e.preventDefault();
      const target = document.getElementById("subscribe");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else {
      e.preventDefault();
      void navigate("/#subscribe");
    }
  };

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-[860px] items-center justify-between px-4 sm:px-6 md:px-8 py-4">
        <span className="text-sm font-semibold text-neutral-900">AI Newsletter</span>
        <div className="flex items-center gap-2">
          <a
            href="/#subscribe"
            onClick={handleSubscribeClick}
            className="inline-flex items-center min-h-[44px] px-2 text-sm text-neutral-600 hover:text-neutral-900"
          >
            Subscribe
          </a>
          <a
            href="https://vertexcover.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center min-h-[44px] px-2 text-sm text-neutral-600 hover:text-neutral-900"
          >
            About
          </a>
        </div>
      </div>
    </nav>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="mt-12 md:mt-16 py-6 md:py-8 px-4 sm:px-6 md:px-8 text-center font-mono text-xs text-neutral-500">
      Made by Vertexcover
    </footer>
  );
}

export function PublicLayout(): ReactElement {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (pathname === "/" && hash === "#subscribe") {
      // The listing fetches archives async; the #subscribe section mounts only
      // after the data resolves, so we poll briefly until it appears.
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
    <div className="min-h-screen bg-white">
      <Nav />
      <Outlet />
      <Footer />
    </div>
  );
}
