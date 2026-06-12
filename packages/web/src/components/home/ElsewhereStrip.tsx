import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useTenantConfig } from "../shell/TenantConfigProvider";

interface Column {
  key: string;
  title: string;
  text: string;
  to: string;
  cta: string;
}

const GRID_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

export function ElsewhereStrip(): ReactElement {
  const config = useTenantConfig();
  const flags = config?.flags;

  const columns: Column[] = [];
  if (flags?.canon) {
    columns.push({
      key: "must-read",
      title: "Must Read",
      text: "The seminal essays on agentic coding, harness engineering, and the software factory. Annotated.",
      to: "/must-read",
      cta: "Browse the canon →",
    });
  }
  columns.push({
    key: "sources",
    title: "Sources",
    text: "The places we read every morning to produce the daily digest. With live counts.",
    to: "/sources",
    cta: "See the list →",
  });
  if (flags?.built) {
    columns.push({
      key: "built",
      title: "How it's built",
      text: "How AgentLoop itself is built — using the same harness engineering practices it covers.",
      to: "/built",
      cta: "See how it's built →",
    });
  }

  return (
    <section data-section="elsewhere" className="py-20">
      <div className="font-mono uppercase text-[12px] tracking-[0.2em] text-[#6b6557] mb-8">
        ELSEWHERE
      </div>
      <div
        className={`grid grid-cols-1 ${GRID_COLS[columns.length] ?? "md:grid-cols-3"} gap-0`}
      >
        {columns.map((column, idx) => (
          <div
            key={column.key}
            data-column={column.key}
            className={
              idx === 0
                ? "px-0 md:pl-0 md:pr-8 md:py-1 py-7 first:pt-0"
                : "px-0 md:px-8 md:py-1 py-7 border-t md:border-t-0 md:border-l border-[#e7e2d6] last:pb-0 md:last:pr-0"
            }
          >
            <h4 className="m-0 mb-3.5 font-serif font-medium text-[23px] leading-[1.15] tracking-[-0.012em] text-[#14110d]">
              {column.title}
            </h4>
            <p className="m-0 mb-4.5 font-serif italic font-normal text-[15.5px] leading-[1.55] text-[#6b6557]">
              {column.text}
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
