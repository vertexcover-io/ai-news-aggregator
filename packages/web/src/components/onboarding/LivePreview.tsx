import { type ReactElement, type ReactNode } from "react";

interface LivePreviewProps {
  name: string;
  slug: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
  logoUrl: string | null;
}

function renderAccent(headline: string): ReactNode {
  const parts = headline.split(/\*(.+?)\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <em key={i} className="text-[#8c3a1e] italic not-italic font-medium">
        <span className="italic">{part}</span>
      </em>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function LivePreview({
  name,
  slug,
  headline,
  topicStrip,
  subtagline,
  logoUrl,
}: LivePreviewProps): ReactElement {
  const word = (name || "Your newsletter").toUpperCase();
  const safeSlug =
    slug.toLowerCase().replace(/[^a-z0-9-]/g, "") || "yourslug";
  const headlineText = headline || "Your headline";
  const stripText = (topicStrip || "Your topics").toUpperCase();

  return (
    <aside
      data-testid="live-preview"
      className="hidden lg:flex flex-col border-l border-[#e7e2d6] p-8 sticky top-[51px] h-[calc(100vh-51px)] bg-gradient-to-b from-[#f3efe6] to-[#ece7da]"
    >
      <div className="mb-3.5 flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-[#6b6557]">
        <span className="inline-block size-2 rounded-full bg-[#8c3a1e]" />
        Live preview · public homepage
      </div>
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[#d6cfbf] bg-white shadow-[0_18px_40px_rgba(20,17,13,.16)]">
        <div className="flex items-center gap-2 border-b border-[#e7e2d6] bg-[#f7f3ea] px-3 py-2.5">
          <span className="flex gap-1.5">
            <i className="block size-2 rounded-full bg-[#d6cfbf]" />
            <i className="block size-2 rounded-full bg-[#d6cfbf]" />
            <i className="block size-2 rounded-full bg-[#d6cfbf]" />
          </span>
          <span className="flex-1 rounded-md border border-[#e7e2d6] bg-white px-2.5 py-1 font-mono text-[11px] text-[#6b6557]">
            <b className="text-[#14110d]" data-testid="pv-url">
              {safeSlug}
            </b>
            .ourdomain.com
          </span>
        </div>
        <div className="overflow-hidden px-6 pt-6">
          <div className="flex items-center justify-between border-b border-[#e7e2d6] pb-3.5">
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="size-6 rounded-md object-cover"
                  data-testid="pv-logo-img"
                />
              ) : (
                <span className="grid size-6 place-items-center rounded-md border border-dashed border-[#d6cfbf] bg-[#efe9dc] font-mono text-[9px] text-[#9b9384]">
                  LOGO
                </span>
              )}
              <span
                className="font-mono font-semibold tracking-[0.1em] uppercase text-sm text-[#14110d]"
                data-testid="pv-word"
              >
                {word}
              </span>
            </div>
            <div className="font-mono text-[8.5px] tracking-[0.14em] uppercase text-[#6b6557]">
              Sources <b className="text-[#8c3a1e]">·</b> Subscribe
            </div>
          </div>
          <div className="py-6 text-center">
            <h3
              className="mx-auto max-w-[16ch] font-serif text-[26px] font-medium leading-[1.1] tracking-[-0.012em] text-[#14110d]"
              data-testid="pv-headline"
            >
              {renderAccent(headlineText)}
            </h3>
            <div className="mt-3 font-mono text-[8px] tracking-[0.2em] uppercase text-[#6b6557]">
              {stripText}
            </div>
            {subtagline ? (
              <div className="mt-1.5 font-mono text-[7.5px] tracking-[0.2em] uppercase text-[#9b9384]">
                {subtagline.toUpperCase()}
              </div>
            ) : null}
          </div>
          <div className="border-t border-[#e7e2d6] pt-4">
            <div className="font-mono text-[8px] tracking-[0.18em] uppercase text-[#8c3a1e]">
              Today&apos;s issue · placeholder
            </div>
            <div className="mt-2.5 h-3.5 w-[70%] rounded bg-[#ece7da]" />
            <div className="my-1.5 h-2.5 w-[96%] rounded bg-[#ece7da]" />
            <div className="my-1.5 h-2.5 w-[88%] rounded bg-[#ece7da]" />
            <div className="mt-3.5">
              {[
                ["Lorem ipsum dolor sit amet…", "JUN 09"],
                ["Consectetur adipiscing elit…", "JUN 08"],
                ["Sed do eiusmod tempor…", "JUN 07"],
              ].map(([title, date]) => (
                <div
                  key={date}
                  className="flex justify-between gap-3 border-t border-[#e7e2d6] py-2.5"
                >
                  <span className="font-serif text-[13px] text-[#9b9384]">
                    {title}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.08em] text-[#9b9384]">
                    {date}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
