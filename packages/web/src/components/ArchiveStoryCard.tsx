import { useState, type ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";

interface Props {
  item: RankedItem;
  rank: number;
}

const SOURCE_LABEL: Record<RankedItem["sourceType"], string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  rss: "RSS",
  blog: "Blog",
  twitter: "X / Twitter",
  github: "GitHub",
  newsletter: "Newsletter",
  web_search: "Web Search",
};

function sourceLabel(item: RankedItem): string {
  return SOURCE_LABEL[item.sourceType];
}

function readVerb(sourceType: RankedItem["sourceType"]): string {
  if (sourceType === "github") return "Read repo";
  return "Read source";
}

export function ArchiveStoryCard({ item, rank }: Props): ReactElement {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imgError;
  const headlineId = `story-${String(rank)}-${String(item.id)}`;

  const recap = item.recap;
  const hasUnpacked = recap !== null && recap.bullets.length >= 1;
  const hasBottomLine = recap !== null && recap.bottomLine.length > 0;

  return (
    <article
      aria-labelledby={headlineId}
      className="border-t border-[#e7e2d6] py-10 sm:py-14 first:border-t-0 first:pt-0"
    >
      <h2
        id={headlineId}
        className="font-serif font-medium leading-[1.18] tracking-[-0.008em] text-[#14110d] text-[24px] sm:text-[28px] md:text-[30px] m-0 mb-4"
      >
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-[position:0_100%] bg-no-repeat text-inherit no-underline transition-[background-size,color] duration-300 ease-out hover:bg-[length:100%_1px] hover:text-[#8c3a1e] after:ml-1 after:font-mono after:text-[14px] after:text-[#8a8472] after:content-['↗'] hover:after:text-[#8c3a1e]"
        >
          {item.title}
        </a>
      </h2>

      {recap !== null ? (
        <p className="font-serif italic leading-[1.55] text-[#2a261f] text-[17px] sm:text-[18px] m-0 mb-6">
          {recap.summary}
        </p>
      ) : (
        <p className="font-serif leading-[1.55] text-[#2a261f] text-[17px] sm:text-[18px] m-0 mb-6">
          {item.rationale}
        </p>
      )}

      {showImage && item.imageUrl !== null ? (
        <img
          src={item.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            setImgError(true);
          }}
          className="mb-7 block w-full rounded-lg border border-[#e7e2d6] bg-[#f1ede2] object-cover aspect-[16/9]"
        />
      ) : null}

      {hasUnpacked ? (
        <div className="mb-6">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#8c3a1e] m-0 mb-[10px]">
            Unpacked
          </p>
          <ul className="list-none p-0 m-0 space-y-0">
            {recap.bullets.map((b) => (
              <li
                key={b}
                className="font-serif text-[16px] sm:text-[17px] leading-[1.55] text-[#2a261f] py-[6px] pl-[22px] relative"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[6px] text-[#8c3a1e]"
                >
                  —
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasBottomLine ? (
        <div className="my-5 rounded-r-md border-l-[3px] border-[#8c3a1e] bg-[#ffffff] px-5 py-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[#8c3a1e] m-0 mb-2">
            Bottom line
          </p>
          <p className="font-serif italic font-medium leading-[1.45] tracking-[-0.005em] text-[#14110d] text-[17px] sm:text-[18px] m-0">
            {recap.bottomLine}
          </p>
        </div>
      ) : null}

      <div className="mt-2 inline-flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#6b6557]">
        <span>{sourceLabel(item)}</span>
        <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-[#8a8472]" />
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="border-b border-[#14110d] pb-px text-[#14110d] hover:border-[#8c3a1e] hover:text-[#8c3a1e]"
        >
          {readVerb(item.sourceType)} ↗
        </a>
      </div>
    </article>
  );
}
