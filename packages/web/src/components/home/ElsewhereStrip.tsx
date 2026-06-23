import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useTenantBranding } from "../../hooks/useTenantBranding";

interface ElsewhereColumn {
  key: string;
  title: string;
  blurb: string;
  to: string;
  cta: string;
}

/**
 * Positional layout classes reproduce the original three-column strip
 * markup exactly when all columns render: first column flush-left, last
 * flush-right, every non-first column separated by a hairline.
 */
function columnClasses(index: number, count: number): string {
  const left = index === 0 ? "md:pl-0" : "md:pl-8";
  const right = index === count - 1 ? "md:pr-0" : "md:pr-8";
  const border =
    index === 0 ? "" : " border-t md:border-t-0 md:border-l border-[#e7e2d6]";
  return `px-0 ${left} ${right} md:py-1 py-7 first:pt-0 last:pb-0${border}`;
}

export function ElsewhereStrip(): ReactElement {
  const branding = useTenantBranding();

  // Same derivation as the nav (REQ-042): Sources always; Must Read only
  // when Canon is on; How-it's-built only for tenant 0 (EDGE-014: a disabled
  // Canon hides the column — data is retained server-side).
  const columns: ElsewhereColumn[] = [
    ...(branding.flags.canon
      ? [
          {
            key: "must-read",
            title: "Must Read",
            blurb:
              "The seminal essays on agentic coding, harness engineering, and the software factory. Annotated.",
            to: "/must-read",
            cta: "Browse the canon →",
          },
        ]
      : []),
    {
      key: "sources",
      title: "Sources",
      blurb:
        "The places we read every morning to produce the daily digest. With live counts.",
      to: "/sources",
      cta: "See the list →",
    },
    ...(branding.isTenantZero
      ? [
          {
            key: "built",
            title: "How it's built",
            blurb:
              "How AgentLoop itself is built — using the same harness engineering practices it covers.",
            to: "/built",
            cta: "See how it's built →",
          },
        ]
      : []),
  ];

  return (
    <section data-section="elsewhere" className="py-20">
      <div className="font-mono uppercase text-[12px] tracking-[0.2em] text-[#6b6557] mb-8">
        ELSEWHERE
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
        {columns.map((column, index) => (
          <div
            key={column.key}
            data-column={column.key}
            className={columnClasses(index, columns.length)}
          >
            <h4 className="m-0 mb-3.5 font-serif font-medium text-[23px] leading-[1.15] tracking-[-0.012em] text-[#14110d]">
              {column.title}
            </h4>
            <p className="m-0 mb-4.5 font-serif italic font-normal text-[15.5px] leading-[1.55] text-[#6b6557]">
              {column.blurb}
            </p>
            <Link
              to={column.to}
              className="font-mono uppercase text-[11.5px] tracking-[0.18em] text-[#8c3a1e] hover:text-[#14110d]"
            >
              {column.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
