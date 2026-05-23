import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";

interface DirectoryItem {
  label: string;
  to: string;
  match?: (pathname: string) => boolean;
}

const ITEMS: readonly DirectoryItem[] = [
  { label: "Today", to: "/", match: (p) => p === "/" },
  {
    label: "Must Read",
    to: "/must-read",
    match: (p) => p.startsWith("/must-read"),
  },
  { label: "Built", to: "/built", match: (p) => p.startsWith("/built") },
  { label: "RSS", to: "/rss", match: (p) => p.startsWith("/rss") },
];

export function DirectoryNav(): ReactElement {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Directory"
      data-nav="directory"
      className="py-[14px] sm:py-[18px]"
    >
      <ul className="list-none m-0 p-0 flex flex-wrap gap-0">
        {ITEMS.map((item, idx) => {
          const isActive = item.match ? item.match(pathname) : false;
          return (
            <li key={item.to} className="inline-flex items-center">
              {idx > 0 ? (
                <span
                  aria-hidden="true"
                  className="mx-[14px] font-mono text-[11px] text-[#6b6557]"
                >
                  ·
                </span>
              ) : null}
              <Link
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className={`font-mono font-medium text-[11px] tracking-[0.2em] uppercase py-[2px] transition-colors ${
                  isActive
                    ? "text-[#8c3a1e] border-b border-[#8c3a1e] pb-[2px]"
                    : "text-[#4a463e] hover:text-[#14110d]"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
