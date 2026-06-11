import { Fragment, useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { getHome } from "../api/home";
import { setMeta } from "../lib/meta";
import {
  brandDisplayName,
  useTenantBranding,
} from "../hooks/useTenantBranding";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { TodaysIssueBlock } from "../components/home/TodaysIssueBlock";
import { FromTheCanonBlock } from "../components/home/FromTheCanonBlock";
import { ElsewhereStrip } from "../components/home/ElsewhereStrip";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

/** "… ship with agents." → ["… ship with", "agents."] — the last word gets the rust italic accent. */
function splitHeadline(headline: string): [string, string] {
  const trimmed = headline.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return ["", trimmed];
  return [trimmed.slice(0, lastSpace), trimmed.slice(lastSpace + 1)];
}

/** Non-breaking spaces inside each strip segment, exactly as the legacy markup. */
function noBreak(segment: string): string {
  return segment.replace(/ /g, " ");
}

function Hero({ branding }: { branding: TenantBranding }): ReactElement {
  const [lead, accent] = splitHeadline(branding.headline ?? "");
  const stripSegments = (branding.topicStrip ?? "")
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return (
    <section className="pt-16 pb-14 text-center">
      <h1 className="font-serif font-medium text-[clamp(40px,6.4vw,68px)] leading-[1.02] tracking-[-0.018em] m-0 mx-auto max-w-[14ch] text-[#14110d]">
        {lead}
        {lead ? " " : null}
        <span className="text-[#8c3a1e] italic font-medium">{accent}</span>
      </h1>
      {stripSegments.length > 0 ? (
        <div className="mt-9 mx-auto font-mono text-[11px] tracking-[0.22em] uppercase text-[#14110d] max-w-[820px] leading-[2]">
          {stripSegments.map((segment, index) => (
            <Fragment key={segment}>
              {index > 0 ? (
                <>
                  {" "}
                  <span className="text-[#8c3a1e] mx-2.5">·</span>{" "}
                </>
              ) : null}
              {noBreak(segment)}
            </Fragment>
          ))}
        </div>
      ) : null}
      {branding.subtagline ? (
        <div className="mt-5 mx-auto font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6b6557] max-w-[760px]">
          {branding.subtagline}
        </div>
      ) : null}
    </section>
  );
}

export function HomePage(): ReactElement {
  const branding = useTenantBranding();
  const displayName = brandDisplayName(branding);
  const headline = branding.headline;
  useEffect(() => {
    document.title = headline ? `${displayName} — ${headline}` : displayName;
    setMeta("description", headline ?? "");
  }, [displayName, headline]);

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
    </>
  );
}
