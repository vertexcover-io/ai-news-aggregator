import type { ReactElement, ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";
import { Kicker, DisplayHeading } from "@/components/auth/fields";

/**
 * Single centered branded card (forgot-password, reset-password) from
 * `mocks/{forgot,reset}-password.html`: a centered brandmark + rust kicker +
 * serif display heading above a cream-elev card. The heading stays an `<h1>`
 * (no auth e2e asserts its text, but it keeps a single page heading).
 */
export function AuthCard({
  kicker,
  heading,
  children,
}: {
  kicker: string;
  heading: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="grid min-h-screen place-items-center bg-cream px-6 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark size={30} className="text-rust" />
          <Kicker tone="rust">{kicker}</Kicker>
          <DisplayHeading className="text-[24px]">{heading}</DisplayHeading>
        </div>
        <div className="rounded-[14px] border border-line bg-cream-elev p-6 shadow-[0_1px_2px_rgba(20,17,13,0.04)]">
          {children}
        </div>
      </div>
    </div>
  );
}
