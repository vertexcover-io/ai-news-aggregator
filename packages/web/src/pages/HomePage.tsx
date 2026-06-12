import { type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHome } from "../api/home";
import { setMeta } from "../lib/meta";
import { ArchiveRow } from "../components/archive-listing/ArchiveRow";
import { TodaysIssueBlock } from "../components/home/TodaysIssueBlock";
import { FromTheCanonBlock } from "../components/home/FromTheCanonBlock";
import { ElsewhereStrip } from "../components/home/ElsewhereStrip";
import { InlineSubscribeCard } from "../components/shell/InlineSubscribeCard";
import {
  useTenantConfig,
  useTenantPageTitle,
} from "../components/shell/TenantConfigProvider";

/** Renders the configured headline with the closing word emphasised, matching
 * the AGENTLOOP hero treatment and the public-home mock. */
function Headline({ headline }: { headline: string }): ReactElement {
  const trimmed = headline.trim();
  const splitAt = trimmed.lastIndexOf(" ");
  const lead = splitAt === -1 ? "" : trimmed.slice(0, splitAt + 1);
  const emphasis = splitAt === -1 ? trimmed : trimmed.slice(splitAt + 1);
  return (
    <h1 className="font-serif font-medium text-[clamp(40px,6.4vw,68px)] leading-[1.02] tracking-[-0.018em] m-0 mx-auto max-w-[14ch] text-[#14110d]">
      {lead}
      <span className="text-[#8c3a1e] italic font-medium">{emphasis}</span>
    </h1>
  );
}

function TopicStrip({ strip }: { strip: string }): ReactElement {
  const segments = strip
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return (
    <div className="mt-9 mx-auto font-mono text-[11px] tracking-[0.22em] uppercase text-[#14110d] max-w-[820px] leading-[2]">
      {segments.map((segment, idx) => (
        <span key={`${segment}-${String(idx)}`}>
          {idx > 0 ? <span className="text-[#8c3a1e] mx-2.5">·</span> : null}
          {segment}
        </span>
      ))}
    </div>
  );
}

function Hero(): ReactElement | null {
  const config = useTenantConfig();
  if (!config) return null;
  return (
    <section className="pt-16 pb-14 text-center">
      {config.headline ? <Headline headline={config.headline} /> : null}
      {config.topicStrip ? <TopicStrip strip={config.topicStrip} /> : null}
      {config.subtagline ? (
        <div className="mt-5 mx-auto font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6b6557] max-w-[760px]">
          {config.subtagline}
        </div>
      ) : null}
    </section>
  );
}

export function HomePage(): ReactElement {
  useTenantPageTitle((config) => {
    const description = config.subtagline ?? config.headline;
    if (description) setMeta("description", description);
    return config.headline ? `${config.name} — ${config.headline}` : config.name;
  });

  const config = useTenantConfig();
  const { data } = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
  });

  const todaysIssue = data?.todaysIssue ?? null;
  // EDGE-014: a tenant that disables Canon keeps its retained entries hidden
  // everywhere — same `!== false` gate as MustReadPage/nav.
  const canonEnabled = config?.flags.canon !== false;
  const featuredCanon = canonEnabled ? (data?.featuredCanon ?? null) : null;
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
