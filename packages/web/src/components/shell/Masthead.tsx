import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAdminSession } from "../../hooks/useAdminSession";
import { BrandMark } from "./BrandMark";

type ActiveNavItem = "must-read" | "sources" | "built" | null;

function deriveActive(pathname: string): ActiveNavItem {
  if (pathname.startsWith("/must-read")) return "must-read";
  if (pathname.startsWith("/sources")) return "sources";
  if (pathname.startsWith("/built")) return "built";
  return null;
}

interface NavLinkProps {
  to: string;
  active: boolean;
  hideOnMobile?: boolean;
  children: React.ReactNode;
}

function NavLink({
  to,
  active,
  hideOnMobile = false,
  children,
}: NavLinkProps): ReactElement {
  const base =
    "font-mono text-[12px] uppercase tracking-[0.18em] font-medium transition-colors";
  const visibility = hideOnMobile ? "hidden sm:inline-block" : "inline-block";
  const colour = active
    ? "text-[#8c3a1e] border-b border-[#8c3a1e] pb-[2px]"
    : "text-[#6b6557] hover:text-[#14110d]";
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`${base} ${visibility} ${colour}`}
    >
      {children}
    </Link>
  );
}

export function Masthead(): ReactElement {
  const { pathname } = useLocation();
  const active = deriveActive(pathname);
  const { data: session } = useAdminSession();
  const isAdmin = session?.admin === true;

  return (
    <header
      data-nav="top-right"
      className="flex items-end justify-between gap-4 pb-9"
    >
      <div className="block leading-none">
        <Link
          to="/"
          aria-label="AGENTLOOP — home"
          className="flex items-center gap-2.5 sm:gap-3"
        >
          <BrandMark
            size={30}
            className="shrink-0 text-[#8c3a1e] sm:h-9 sm:w-9"
          />
          <div className="font-mono text-[22px] sm:text-[30px] font-semibold tracking-[0.12em] text-[#14110d] uppercase">
            AGENTLOOP
          </div>
        </Link>
        <div className="mt-2 font-mono text-[10.5px] tracking-[0.22em] uppercase text-[#6b6557]">
          A{" "}
          <a
            href="https://blog.vertexcover.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#6b6557] underline decoration-dotted underline-offset-[3px] hover:text-[#14110d]"
          >
            Vertexcover Labs
          </a>{" "}
          publication
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="flex items-baseline gap-0 text-[12px]"
      >
        <NavLink to="/must-read" active={active === "must-read"} hideOnMobile>
          Must Read
        </NavLink>
        <span
          aria-hidden="true"
          className="hidden sm:inline mx-3 text-[#6b6557]"
        >
          ·
        </span>
        <NavLink to="/sources" active={active === "sources"} hideOnMobile>
          Sources
        </NavLink>
        <span
          aria-hidden="true"
          className="hidden sm:inline mx-3 text-[#6b6557]"
        >
          ·
        </span>
        <NavLink to="/built" active={active === "built"} hideOnMobile>
          How it&apos;s built
        </NavLink>
        <span
          aria-hidden="true"
          className="hidden sm:inline mx-3 text-[#6b6557]"
        >
          ·
        </span>
        {isAdmin ? (
          <>
            <Link
              to="/admin"
              className="font-mono text-[12px] uppercase tracking-[0.18em] font-medium text-[#14110d] transition-colors hover:text-[#8c3a1e]"
            >
              Admin&nbsp;→
            </Link>
            <span
              aria-hidden="true"
              className="hidden sm:inline mx-3 text-[#6b6557]"
            >
              ·
            </span>
          </>
        ) : null}
        <Link
          to={{ hash: "#subscribe" }}
          className="font-mono text-[12px] uppercase tracking-[0.18em] font-medium text-[#14110d] transition-colors hover:text-[#8c3a1e]"
        >
          Subscribe&nbsp;→
        </Link>
      </nav>
    </header>
  );
}
