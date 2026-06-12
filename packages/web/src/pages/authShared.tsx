import type { ReactElement, ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";

export const kickerClass =
  "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8c3a1e]";

export const labelClass =
  "block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#6b6557] mb-1.5";

export const inputClass =
  "w-full min-h-[44px] rounded-md border border-[#d4ceba] bg-white px-3 py-2.5 text-[14px] text-[#14110d] outline-none placeholder:text-[#8a8472] focus:border-[#8c3a1e] focus:shadow-[0_0_0_3px_rgba(140,58,30,0.14)]";

export const inputInvalidClass =
  "border-[#9e2b1a] focus:border-[#9e2b1a] focus:shadow-[0_0_0_3px_rgba(158,43,26,0.12)]";

export const errClass =
  "mt-1.5 font-mono text-[12px] tracking-[0.02em] text-[#9e2b1a]";

export const helpClass = "text-[12.5px] leading-relaxed text-[#6b6557]";

export const cardClass =
  "rounded-lg border border-[#e7e2d6] bg-white p-5 shadow-sm";

export const primaryBtnClass =
  "w-full min-h-[44px] rounded-md bg-[#14110d] px-4 py-2.5 text-[14px] font-medium text-[#fbfaf7] transition-colors hover:bg-black disabled:opacity-60";

export const rustBtnClass =
  "w-full min-h-[44px] rounded-md bg-[#8c3a1e] px-4 py-3 text-[14px] font-medium text-[#fbfaf7] transition-colors hover:bg-[#6e2d17] disabled:opacity-60";

interface AuthCenterShellProps {
  kicker: string;
  heading: string;
  children: ReactNode;
}

export function AuthCenterShell({
  kicker,
  heading,
  children,
}: AuthCenterShellProps): ReactElement {
  return (
    <div className="min-h-screen grid place-items-center bg-[#fbfaf7] px-5 py-8 font-sans text-[#14110d]">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-6">
          <BrandMark size={30} className="mx-auto mb-3.5 text-[#8c3a1e]" />
          <p className={kickerClass}>{kicker}</p>
          <h1 className="mt-1 font-serif text-[28px] font-medium tracking-[-0.01em]">
            {heading}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
