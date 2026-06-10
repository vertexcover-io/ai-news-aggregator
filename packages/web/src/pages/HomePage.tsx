import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHome } from "../api/home";
import { setMeta } from "../lib/meta";
import { useBrand } from "../context/TenantBrandingContext";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { TodaysIssueBlock } from "../components/home/TodaysIssueBlock";
import { FromTheCanonBlock } from "../components/home/FromTheCanonBlock";
import { ElsewhereStrip } from "../components/home/ElsewhereStrip";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

const DEFAULT_TOPICS = [
  "AGENTIC CODING",
  "HARNESS ENGINEERING",
  "CONTEXT ENGINEERING",
  "THE SOFTWARE FACTORY",
];
const DEFAULT_SUBTAGLINE =
  "No model releases. No benchmarks. No discourse. Just the craft.";

function splitTopics(strip: string | null): string[] {
  if (strip === null) return DEFAULT_TOPICS;
  const items = strip
    .split("·")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : DEFAULT_TOPICS;
}

function Hero(): ReactElement {
  const brand = useBrand();
  const headline = brand.headline;
  const topics = splitTopics(brand.topicStrip);
  const subtagline = brand.subtagline ?? DEFAULT_SUBTAGLINE;
  return (
    <section className="pt-16 pb-14 text-center">
      <h1 className="font-serif font-medium text-[clamp(40px,6.4vw,68px)] leading-[1.02] tracking-[-0.018em] m-0 mx-auto max-w-[14ch] text-[#14110d]">
        {headline}
      </h1>
      <div className="mt-9 mx-auto font-mono text-[11px] tracking-[0.22em] uppercase text-[#14110d] max-w-[820px] leading-[2]">
        {topics.map((topic, idx) => (
          <span key={topic}>
            {idx > 0 ? <span className="text-[#8c3a1e] mx-2.5">·</span> : null}
            {topic.replace(/ /g, " ")}
          </span>
        ))}
      </div>
      <div className="mt-5 mx-auto font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6b6557] max-w-[760px]">
        {subtagline}
      </div>
    </section>
  );
}

export function HomePage(): ReactElement {
  const brand = useBrand();
  useEffect(() => {
    document.title = `${brand.name} — ${brand.headline}`;
    setMeta("description", brand.headline);
  }, [brand.name, brand.headline]);

  const { data } = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
  });

  const todaysIssue = data?.todaysIssue ?? null;
  const featuredCanon = data?.featuredCanon ?? null;
  const recentIssuesRaw = data?.recentIssues ?? [];
  const recentIssues =
    todaysIssue == null
      ? recentIssuesRaw
      : recentIssuesRaw.filter((r) => r.runId !== todaysIssue.runId);

  return (
    <>
      <hr className="border-0 border-t-2 border-[#14110d] m-0" />
      <Hero />
      <hr className="border-0 border-t-2 border-[#14110d] m-0" />

      {todaysIssue ? <TodaysIssueBlock issue={todaysIssue} /> : null}

      {todaysIssue ? <hr className="border-0 border-t border-[#e7e2d6] m-0" /> : null}

      {featuredCanon ? <FromTheCanonBlock entry={featuredCanon} /> : null}

      {featuredCanon ? <hr className="border-0 border-t border-[#e7e2d6] m-0" /> : null}

      <InlineSubscribeCard />

      {recentIssues.length > 0 ? (
        <>
          <hr className="border-0 border-t border-[#e7e2d6] m-0" />
          <section data-section="recent-issues" className="py-7">
            <div className="flex items-center justify-between pb-4">
              <div className="font-mono uppercase tracking-[0.22em] text-[11px] text-[#14110d]">
                Recent issues
              </div>
              <div className="font-mono uppercase tracking-[0.2em] text-[10.5px] text-[#6b6557]">
                {recentIssues.length}{" "}
                {recentIssues.length === 1 ? "issue" : "issues"}
              </div>
            </div>
            <ul className="archive-list list-none p-0 m-0">
              {recentIssues.slice(0, 10).map((item, idx) => (
                <ArchiveRow
                  key={`${item.runId}-${String(idx)}`}
                  item={item}
                  issueNumber={recentIssues.length - idx}
                  featured={false}
                />
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <hr className="border-0 border-t border-[#e7e2d6] m-0" />
      <ElsewhereStrip />
    </>
  );
}
