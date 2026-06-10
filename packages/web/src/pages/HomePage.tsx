import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHome } from "../api/home";
import { setMeta } from "../lib/meta";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { TodaysIssueBlock } from "../components/home/TodaysIssueBlock";
import { FromTheCanonBlock } from "../components/home/FromTheCanonBlock";
import { ElsewhereStrip } from "../components/home/ElsewhereStrip";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";
import { TenantBrandingProvider } from "../context/TenantBrandingContext";
import type { TenantBranding } from "@newsletter/shared/types";

const DEFAULT_TAGLINE = "The daily read for people who ship with agents.";

function Hero({ branding }: { branding: TenantBranding }): ReactElement {
  const headline = branding.headline ?? DEFAULT_TAGLINE;
  const strip = branding.topicStrip;
  const subtag = branding.subtagline;

  return (
    <section className="pt-16 pb-14 text-center">
      <h1 className="font-serif font-medium text-[clamp(40px,6.4vw,68px)] leading-[1.02] tracking-[-0.018em] m-0 mx-auto max-w-[14ch] text-[#14110d]">
        {headline}
      </h1>
      {strip ? (
        <div className="mt-9 mx-auto font-mono text-[11px] tracking-[0.22em] uppercase text-[#14110d] max-w-[820px] leading-[2]">
          {strip}
        </div>
      ) : null}
      {subtag ? (
        <div className="mt-5 mx-auto font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6b6557] max-w-[760px]">
          {subtag}
        </div>
      ) : null}
    </section>
  );
}

export function HomePage(): ReactElement {
  const { data } = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
  });

  const branding: TenantBranding = data?.branding ?? {
    name: "AGENTLOOP",
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoUrl: null,
    flags: { canon: true, isTenantZero: true },
  };

  const title =
    branding.headline ?? `${branding.name} — ${DEFAULT_TAGLINE}`;

  useEffect(() => {
    document.title = title;
    setMeta("description", branding.subtagline ?? DEFAULT_TAGLINE);
  }, [title, branding.subtagline]);

  const todaysIssue = data?.todaysIssue ?? null;
  const featuredCanon = data?.featuredCanon ?? null;
  const recentIssuesRaw = data?.recentIssues ?? [];
  const recentIssues =
    todaysIssue == null
      ? recentIssuesRaw
      : recentIssuesRaw.filter((r) => r.runId !== todaysIssue.runId);

  return (
    <TenantBrandingProvider branding={branding}>
      <hr className="border-0 border-t-2 border-[#14110d] m-0" />
      <Hero branding={branding} />
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
    </TenantBrandingProvider>
  );
}
