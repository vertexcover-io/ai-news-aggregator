import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHome } from "../api/home";
import { setMeta } from "../lib/meta";
import {
  brandDisplayName,
  useTenantBranding,
} from "../hooks/useTenantBranding";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { Hero } from "../components/home/Hero";
import { TodaysIssueBlock } from "../components/home/TodaysIssueBlock";
import { FromTheCanonBlock } from "../components/home/FromTheCanonBlock";
import { ElsewhereStrip } from "../components/home/ElsewhereStrip";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";

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
  // Fix #4: also gate on the canon flag so the block never shows for a tenant
  // with canon off (the API nulls featuredCanon too — this is belt-and-braces).
  const featuredCanon = branding.flags.canon
    ? (data?.featuredCanon ?? null)
    : null;
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
