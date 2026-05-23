import type { ReactElement } from "react";
import { useEffect } from "react";
import { setMeta } from "../lib/meta";

export function RssPage(): ReactElement {
  useEffect(() => {
    document.title = "RSS — AgentLoop";
    setMeta(
      "description",
      "AgentLoop RSS feed — the daily digest, in your reader.",
    );
  }, []);

  return (
    <main className="mx-auto max-w-[680px] px-4 sm:px-6 md:px-8 py-16">
      <header className="mb-12">
        <div className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#6b6557] mb-6">
          FEED
        </div>
        <h1 className="m-0 font-serif font-medium text-[#14110d] text-[clamp(46px,7vw,72px)] leading-[1.02] tracking-[-0.018em]">
          RSS
        </h1>
        <p className="mt-6 mb-0 font-serif italic text-[20px] leading-[1.55] text-[#6b6557]">
          The daily digest, in your reader. No email required.
        </p>
      </header>

      <hr className="border-0 border-t border-[#e7e2d6] m-0 mb-12" />

      <section className="mb-12">
        <div className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#6b6557] mb-5">
          THE FEED
        </div>
        <p className="m-0 mb-6 font-serif text-[18.5px] leading-[1.65] text-[#14110d]">
          AgentLoop publishes a daily issue, around 7am. The RSS feed mirrors
          the public archive — each reviewed issue lands in your reader the
          moment it&apos;s published.
        </p>
        <div className="border-t border-b border-[#e7e2d6] py-6 my-8">
          <div className="font-mono uppercase text-[10.5px] tracking-[0.22em] text-[#6b6557] mb-3">
            FEED URL
          </div>
          <code className="block font-mono text-[15px] tracking-[0.02em] text-[#14110d] break-all">
            https://news.vertexcover.io/rss.xml
          </code>
        </div>
        <p className="m-0 font-serif italic text-[16px] leading-[1.6] text-[#6b6557]">
          Feed&apos;s not live yet — paste the URL into your reader once it ships
          (or subscribe by email below; we&apos;ll send a note when the feed is
          available).
        </p>
      </section>

      <hr className="border-0 border-t border-[#e7e2d6] m-0 mb-12" />

      <section>
        <div className="font-mono uppercase text-[11.5px] tracking-[0.2em] text-[#6b6557] mb-5">
          READERS WE TEST AGAINST
        </div>
        <ul className="list-none m-0 p-0 font-serif text-[17px] leading-[1.7] text-[#14110d]">
          <li className="border-t border-[#e7e2d6] py-3.5 first:border-t-0 first:pt-0">
            Feedly — works
          </li>
          <li className="border-t border-[#e7e2d6] py-3.5">
            NetNewsWire — works
          </li>
          <li className="border-t border-[#e7e2d6] py-3.5">
            Reeder — works
          </li>
          <li className="border-t border-[#e7e2d6] py-3.5">
            Inoreader — works
          </li>
        </ul>
      </section>
    </main>
  );
}
