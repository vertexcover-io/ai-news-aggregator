import type { ReactElement } from "react";
import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { useTenantBranding } from "../../hooks/useTenantBranding";
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
    "font-mono text-[11px] sm:text-[12px] uppercase tracking-[0.14em] sm:tracking-[0.18em] font-medium transition-colors";
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

function NavSeparator(): ReactElement {
  return (
    <span aria-hidden="true" className="hidden sm:inline mx-3 text-[#6b6557]">
      ·
    </span>
  );
}

export function Masthead(): ReactElement {
  const { pathname } = useLocation();
  const active = deriveActive(pathname);
  const { data: session } = useSession();
  const branding = useTenantBranding();
  const isAdmin = session?.user != null;

  // Per-tenant nav derivation (REQ-042): Sources always; Must Read only when
  // the Canon flag is on; How-it's-built only for tenant 0.
  const navItems: { to: string; key: ActiveNavItem; label: string }[] = [
    ...(branding.flags.canon
      ? [{ to: "/must-read", key: "must-read" as const, label: "Must Read" }]
      : []),
    { to: "/sources", key: "sources" as const, label: "Sources" },
    ...(branding.isTenantZero
      ? [{ to: "/built", key: "built" as const, label: "How it's built" }]
      : []),
  ];

  return (
    <header
      data-nav="top-right"
      className="flex items-end justify-between flex-wrap gap-x-4 gap-y-3 pb-9"
    >
      <div className="block leading-none">
        <Link
          to="/"
          aria-label={`${branding.name} — home`}
          className="flex items-center gap-2.5 sm:gap-3"
        >
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt=""
              className="shrink-0 h-[30px] w-[30px] sm:h-9 sm:w-9 object-contain"
            />
          ) : (
            <BrandMark
              size={30}
              label={branding.name}
              className="shrink-0 text-[#8c3a1e] sm:h-9 sm:w-9"
            />
          )}
          <div className="font-mono text-[22px] sm:text-[30px] font-semibold tracking-[0.12em] text-[#14110d] uppercase">
            {branding.name}
          </div>
        </Link>
        {branding.isTenantZero ? (
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
        ) : null}
      </div>

      <nav
        aria-label="Primary"
        className="flex items-baseline gap-0 text-[12px]"
      >
        {navItems.map((item) => (
          <Fragment key={item.to}>
            <NavLink to={item.to} active={active === item.key} hideOnMobile>
              {item.label}
            </NavLink>
            <NavSeparator />
          </Fragment>
        ))}
        {isAdmin ? (
          <>
            <Link
              to="/admin"
              className="font-mono text-[11px] sm:text-[12px] uppercase tracking-[0.14em] sm:tracking-[0.18em] font-medium text-[#14110d] transition-colors hover:text-[#8c3a1e]"
            >
              Admin&nbsp;→
            </Link>
            <span aria-hidden="true" className="mx-1.5 sm:mx-3 text-[#6b6557]">
              ·
            </span>
          </>
        ) : null}
        <Link
          to={{ hash: "#subscribe" }}
          className="font-mono text-[11px] sm:text-[12px] uppercase tracking-[0.14em] sm:tracking-[0.18em] font-medium text-[#14110d] transition-colors hover:text-[#8c3a1e]"
        >
          Subscribe&nbsp;→
        </Link>
      </nav>
    </header>
  );
}
