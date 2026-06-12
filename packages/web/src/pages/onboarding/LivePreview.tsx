import { useMemo, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, useInRouterContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomePagePayload, ArchiveListItem } from "@newsletter/shared/types";
import { TenantConfigProvider } from "@/components/shell/TenantConfigProvider";
import type { TenantConfig } from "@/api/tenantConfig";
import { Masthead } from "@/components/shell/Masthead";
import { HomePage } from "@/pages/HomePage";

export interface PreviewBranding {
  name: string;
  slug: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
  logoVersion: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function loremIssue(daysAgo: number, headline: string): ArchiveListItem {
  return {
    runId: `preview-${String(daysAgo)}`,
    runDate: isoDaysAgo(daysAgo),
    storyCount: 6,
    topItems: [
      { id: daysAgo * 10 + 1, title: "Lorem ipsum dolor sit amet", sourceType: "hn" },
      { id: daysAgo * 10 + 2, title: "Consectetur adipiscing elit", sourceType: "blog" },
    ],
    leadSummary:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.",
    digestHeadline: headline,
    digestSummary:
      "Plus: ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.",
    isDryRun: false,
  };
}

// REQ-034: everything that is not the tenant's branding is lorem ipsum.
const LOREM_HOME: HomePagePayload = {
  todaysIssue: loremIssue(0, "Lorem Ipsum Dolor Sit Amet, Consectetur Adipiscing"),
  featuredCanon: null,
  recentIssues: [
    loremIssue(1, "Sed Do Eiusmod Tempor Incididunt"),
    loremIssue(2, "Ut Labore Et Dolore Magna Aliqua"),
    loremIssue(3, "Quis Nostrud Exercitation Ullamco"),
  ],
};

/** React Router forbids nesting a <Router> inside another <Router>, so inside
 * the app the preview reuses the wizard's router context (the canvas is
 * pointer-inert, so its links never navigate); standalone (unit tests) it
 * provides its own MemoryRouter. */
function PreviewRouter({ children }: { children: ReactNode }): ReactElement {
  const inRouter = useInRouterContext();
  if (inRouter) return <>{children}</>;
  return <MemoryRouter>{children}</MemoryRouter>;
}

/**
 * REQ-034: live preview of the real public homepage. Reuses the actual
 * Masthead + HomePage components (no iframe, no copy) inside an isolated
 * QueryClient whose queries are disabled — the only data is the seeded
 * lorem-ipsum home payload, and branding flows through TenantConfigProvider's
 * preview escape hatch.
 */
export function LivePreview({ branding }: { branding: PreviewBranding }): ReactElement {
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    client.setQueryData(["home"], LOREM_HOME);
    return client;
  }, []);

  const config: TenantConfig = {
    name: branding.name.trim() || "Your newsletter",
    slug: branding.slug.trim() || "yourslug",
    headline: branding.headline.trim() || "Your headline goes here",
    topicStrip: branding.topicStrip.trim() || "Topic · Topic · Topic",
    subtagline: branding.subtagline.trim() || null,
    logoVersion: branding.logoVersion,
    flags: { canon: false, built: false, deliverability: false },
  };

  return (
    <aside className="hidden xl:flex sticky top-[51px] h-[calc(100vh-51px)] flex-col border-l border-[#e7e2d6] bg-gradient-to-b from-[#f3efe6] to-[#ece7da] p-7">
      <div className="mb-3.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b6557]">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[#8c3a1e]" /> Live
        preview · public homepage
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#d4ceba] bg-white shadow-[0_18px_40px_rgba(20,17,13,0.16)]">
        <div className="flex items-center gap-2 border-b border-[#e7e2d6] bg-[#fbfaf7] px-3 py-2">
          <span className="flex gap-1.5" aria-hidden>
            <i className="block h-2 w-2 rounded-full bg-[#d4ceba]" />
            <i className="block h-2 w-2 rounded-full bg-[#d4ceba]" />
            <i className="block h-2 w-2 rounded-full bg-[#d4ceba]" />
          </span>
          <span
            data-testid="preview-url"
            className="flex-1 rounded border border-[#e7e2d6] bg-white px-2.5 py-1 font-mono text-[11px] text-[#6b6557]"
          >
            <b className="text-[#14110d]">{config.slug}</b>.ourdomain.com
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            data-testid="preview-canvas"
            className="pointer-events-none origin-top-left scale-[0.42] px-10 pt-8"
            style={{ width: "238%" }}
          >
            <PreviewRouter>
              <QueryClientProvider client={queryClient}>
                <TenantConfigProvider value={config}>
                  <Masthead />
                  <HomePage />
                </TenantConfigProvider>
              </QueryClientProvider>
            </PreviewRouter>
          </div>
        </div>
      </div>
    </aside>
  );
}
