import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function ElsewhereStrip(): ReactElement {
  return (
    <section data-section="elsewhere" className="py-20">
      <div className="font-mono uppercase text-[12px] tracking-[0.2em] text-[#6b6557] mb-8">
        ELSEWHERE
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        <div
          data-column="must-read"
          className="px-0 md:pl-0 md:pr-8 md:py-1 py-7 first:pt-0"
        >
          <h4 className="m-0 mb-3.5 font-serif font-medium text-[23px] leading-[1.15] tracking-[-0.012em] text-[#14110d]">
            Must Read
          </h4>
          <p className="m-0 mb-4.5 font-serif italic font-normal text-[15.5px] leading-[1.55] text-[#6b6557]">
            The seminal essays on agentic coding, harness engineering, and the software factory. Annotated.
          </p>
          <Link
            to="/must-read"
            className="font-mono uppercase text-[11.5px] tracking-[0.18em] text-[#8c3a1e] hover:text-[#14110d]"
          >
            Browse the canon →
          </Link>
        </div>
        <div
          data-column="built"
          className="px-0 md:pl-8 md:pr-0 md:py-1 py-7 border-t md:border-t-0 md:border-l border-[#e7e2d6] last:pb-0"
        >
          <h4 className="m-0 mb-3.5 font-serif font-medium text-[23px] leading-[1.15] tracking-[-0.012em] text-[#14110d]">
            Built
          </h4>
          <p className="m-0 mb-4.5 font-serif italic font-normal text-[15.5px] leading-[1.55] text-[#6b6557]">
            How AgentLoop itself is built — using the same harness engineering practices it covers.
          </p>
          <Link
            to="/built"
            className="font-mono uppercase text-[11.5px] tracking-[0.18em] text-[#8c3a1e] hover:text-[#14110d]"
          >
            See how it&apos;s built →
          </Link>
        </div>
      </div>
    </section>
  );
}
