/**
 * Live public-homepage preview (P11, REQ-034). Renders the REAL P7 homepage
 * components (Hero, BrandMark) with the in-progress wizard values — the
 * layout is fixed; tenants only fill the slots. Empty slots fall back to
 * lorem-ipsum / placeholder copy, and the rest of the page (today's issue,
 * archive rows) is always placeholder content.
 */
import type { ReactElement } from "react";
import type {
  OnboardingData,
  TenantBranding,
} from "@newsletter/shared/types/tenant";
import { Hero } from "../home/Hero";
import { BrandMark } from "../shell/BrandMark";
import { PUBLIC_ROOT_DOMAIN } from "./wizardSteps";

const hasText = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

const PREVIEW_PLACEHOLDERS = {
  name: "Your newsletter",
  slug: "yourslug",
  headline: "Your headline goes here",
  topicStrip: "Topic one · Topic two · Topic three",
} as const;

function previewBranding(
  data: OnboardingData,
  logoUrl: string | null,
): TenantBranding {
  return {
    name: hasText(data.name) ? (data.name ?? "") : PREVIEW_PLACEHOLDERS.name,
    headline: hasText(data.headline)
      ? (data.headline ?? "")
      : PREVIEW_PLACEHOLDERS.headline,
    topicStrip: hasText(data.topicStrip)
      ? (data.topicStrip ?? "")
      : PREVIEW_PLACEHOLDERS.topicStrip,
    subtagline: hasText(data.subtagline) ? (data.subtagline ?? "") : null,
    logoUrl,
    flags: { canon: false },
    isTenantZero: false,
  };
}

const LOREM_ROWS = [
  { title: "Lorem ipsum dolor sit amet…", date: "JUN 09" },
  { title: "Consectetur adipiscing elit…", date: "JUN 08" },
  { title: "Sed do eiusmod tempor…", date: "JUN 07" },
] as const;

export interface PreviewPaneProps {
  data: OnboardingData;
  /** Object URL / API URL of the uploaded logo; null → BrandMark fallback. */
  logoUrl: string | null;
}

export function PreviewPane({ data, logoUrl }: PreviewPaneProps): ReactElement {
  const branding = previewBranding(data, logoUrl);
  const slug = hasText(data.slug)
    ? (data.slug ?? "").trim().toLowerCase()
    : PREVIEW_PLACEHOLDERS.slug;

  return (
    <aside
      aria-label="Live preview of your public homepage"
      className="hidden xl:flex flex-col sticky top-[52px] h-[calc(100vh-52px)] border-l border-[#e7e2d6] bg-gradient-to-b from-[#f3efe6] to-[#ece7da] p-8"
    >
      <div className="mb-3.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b6557]">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-[#8c3a1e]"
        />
        Live preview · public homepage
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#d8d2c2] bg-white shadow-[0_18px_40px_rgba(20,17,13,0.16)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[#e7e2d6] bg-[#fafaf7] px-3 py-2">
          <span aria-hidden="true" className="flex gap-1.5">
            <i className="block h-2 w-2 rounded-full bg-[#d8d2c2]" />
            <i className="block h-2 w-2 rounded-full bg-[#d8d2c2]" />
            <i className="block h-2 w-2 rounded-full bg-[#d8d2c2]" />
          </span>
          <span
            data-testid="preview-url"
            className="flex-1 rounded-md border border-[#e7e2d6] bg-white px-2.5 py-1 font-mono text-[11px] text-[#6b6557]"
          >
            <b className="text-[#14110d]">{slug}</b>.{PUBLIC_ROOT_DOMAIN}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 pt-6">
          {/* Mini masthead — same slots as the public Masthead (P7). */}
          <div className="flex items-center justify-between border-b border-[#e7e2d6] pb-3.5">
            <span className="flex items-center gap-2.5">
              {logoUrl !== null ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-[26px] w-[26px] shrink-0 rounded-md object-contain"
                />
              ) : (
                <BrandMark
                  size={26}
                  label={branding.name}
                  className="shrink-0 text-[#8c3a1e]"
                />
              )}
              <span className="font-mono text-[14px] font-semibold uppercase tracking-[0.1em] text-[#14110d]">
                {branding.name}
              </span>
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[#6b6557]">
              Sources <b className="text-[#8c3a1e]">·</b> Subscribe
            </span>
          </div>

          {/* The REAL homepage hero, scaled down to fit the frame. */}
          <div className="origin-top scale-[0.55] -mx-[40%] [&_section]:pt-8 [&_section]:pb-6">
            <Hero branding={branding} />
          </div>

          {/* Everything below the hero is placeholder content (REQ-034). */}
          <div className="border-t border-[#e7e2d6] pt-4">
            <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#8c3a1e]">
              Today’s issue · placeholder
            </div>
            <div aria-hidden="true" className="mt-2.5 space-y-1.5">
              <div className="h-3.5 w-[70%] rounded bg-[#ece7da]" />
              <div className="h-2.5 w-[96%] rounded bg-[#ece7da]" />
              <div className="h-2.5 w-[88%] rounded bg-[#ece7da]" />
            </div>
            <ul className="mt-3.5 list-none space-y-0 p-0">
              {LOREM_ROWS.map((row) => (
                <li
                  key={row.title}
                  className="flex items-center justify-between gap-3 border-t border-[#e7e2d6] py-2"
                >
                  <span className="font-serif text-[13px] text-[#3f3a30]">
                    {row.title}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.08em] text-[#a39d8d]">
                    {row.date}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </aside>
  );
}
