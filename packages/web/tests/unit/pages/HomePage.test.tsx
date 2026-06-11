import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ArchiveListItem,
  HomePagePayload,
  PublicMustReadEntry,
} from "@newsletter/shared/types";
import type { TenantBranding } from "@newsletter/shared/types/tenant";
import { HomePage } from "../../../src/pages/HomePage";
import { PublicLayout } from "../../../src/layouts/PublicLayout";
import {
  AGENTLOOP_BRANDING,
  SECOND_TENANT_BRANDING,
} from "../../helpers/branding";

vi.mock("../../../src/api/home", () => ({
  getHome: vi.fn(),
}));

vi.mock("../../../src/api/branding", () => ({
  getBranding: vi.fn(),
}));

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { getHome } from "../../../src/api/home";
import { getBranding } from "../../../src/api/branding";
const mockGetHome = vi.mocked(getHome);
const mockGetBranding = vi.mocked(getBranding);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeArchive(
  runId: string,
  runDate: string,
  overrides: Partial<ArchiveListItem> = {},
): ArchiveListItem {
  return {
    runId,
    runDate,
    storyCount: 5,
    topItems: [{ id: 1, title: `Top of ${runId}`, sourceType: "hn" }],
    leadSummary: null,
    digestHeadline: `Headline ${runId}`,
    digestSummary: `Summary ${runId}`,
    isDryRun: false,
    ...overrides,
  };
}

function makeCanon(overrides: Partial<PublicMustReadEntry> = {}): PublicMustReadEntry {
  return {
    id: "canon-1",
    url: "https://karpathy.example.com/software-3",
    title: "Software 3.0",
    author: "Andrej Karpathy",
    year: 2025,
    annotation:
      "The piece that named the shift. Read it for the framing, not the predictions.",
    addedAt: "2026-03-28T00:00:00Z",
    ...overrides,
  };
}

function renderHome(
  payload: HomePagePayload,
  branding: TenantBranding = AGENTLOOP_BRANDING,
): ReturnType<typeof render> {
  mockGetHome.mockResolvedValue(payload);
  mockGetBranding.mockResolvedValue(branding);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["home"], payload);
  qc.setQueryData(["branding"], branding);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<HomePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
  it("REQ-002: hero block renders the headline, four pillar chips, and exclusion line", () => {
    renderHome({ todaysIssue: null, featuredCanon: null, recentIssues: [] });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /The daily read for people who ship with agents\./,
      }),
    ).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/AGENTIC\s*CODING/);
    expect(body).toMatch(/HARNESS\s*ENGINEERING/);
    expect(body).toMatch(/CONTEXT\s*ENGINEERING/);
    expect(body).toMatch(/THE\s*SOFTWARE\s*FACTORY/);
    expect(body).toContain(
      "No model releases. No benchmarks. No discourse. Just the craft.",
    );
  });

  it("REQ-003: when todaysIssue present, [data-section='todays-issue'] is present and links to /archive/<runId>", () => {
    const today = makeArchive("run-today", "2026-05-23", {
      digestHeadline: "The OpenAI Codex sandbox just redrew the cost curve.",
    });
    renderHome({ todaysIssue: today, featuredCanon: null, recentIssues: [] });
    const block = document.querySelector('[data-section="todays-issue"]');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain(
      "The OpenAI Codex sandbox just redrew the cost curve.",
    );
    const link = block?.querySelector('a[href="/archive/run-today"]');
    expect(link).not.toBeNull();
  });

  it("REQ-004: when featuredCanon present, [data-section='from-the-canon'] renders title, annotation, and link to entry URL", () => {
    const canon = makeCanon();
    renderHome({ todaysIssue: null, featuredCanon: canon, recentIssues: [] });
    const block = document.querySelector('[data-section="from-the-canon"]');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain("Software 3.0");
    expect(block?.textContent).toContain("The piece that named the shift");
    const link = block?.querySelector(`a[href="${canon.url}"]`);
    expect(link).not.toBeNull();
  });

  it("REQ-006: recent-issues section contains ≤10 rows and does NOT duplicate todaysIssue runId", () => {
    const today = makeArchive("run-today", "2026-05-23");
    const recent: ArchiveListItem[] = Array.from({ length: 12 }, (_, i) =>
      makeArchive(`run-${String(i)}`, `2026-05-${String(20 - i).padStart(2, "0")}`),
    );
    // Inject the todaysIssue into recent to test exclusion
    recent.unshift(today);
    renderHome({ todaysIssue: today, featuredCanon: null, recentIssues: recent });
    const section = document.querySelector('[data-section="recent-issues"]');
    expect(section).not.toBeNull();
    const rows = section?.querySelectorAll("ul.archive-list > li") ?? [];
    expect(rows.length).toBeLessThanOrEqual(10);
    // Today's runId should not appear in the recent rows links
    const todayLinks = section?.querySelectorAll(`a[href="/archive/run-today"]`);
    expect(todayLinks?.length ?? 0).toBe(0);
  });

  it("[data-section='elsewhere'] is present with must-read, sources, and built columns; no tools column", () => {
    renderHome({ todaysIssue: null, featuredCanon: null, recentIssues: [] });
    const elsewhere = document.querySelector('[data-section="elsewhere"]');
    expect(elsewhere).not.toBeNull();
    expect(elsewhere?.querySelector('[data-column="must-read"]')).not.toBeNull();
    expect(elsewhere?.querySelector('[data-column="sources"]')).not.toBeNull();
    expect(elsewhere?.querySelector('[data-column="built"]')).not.toBeNull();
    expect(elsewhere?.querySelector('[data-column="tools"]')).toBeNull();
  });

  it("no legacy DirectoryNav row is rendered (Masthead is the only top nav site-wide)", () => {
    renderHome({ todaysIssue: null, featuredCanon: null, recentIssues: [] });
    expect(document.querySelector('nav[aria-label="Directory"]')).toBeNull();
    expect(document.querySelector('[data-nav="directory"]')).toBeNull();
  });

  it("EDGE-001: with todaysIssue=null, neither Today's Issue nor Recent Issues sections render; hero + subscribe + Elsewhere remain", () => {
    renderHome({ todaysIssue: null, featuredCanon: null, recentIssues: [] });
    expect(document.querySelector('[data-section="todays-issue"]')).toBeNull();
    expect(document.querySelector('[data-section="recent-issues"]')).toBeNull();
    // Hero
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /The daily read for people who ship with agents\./,
      }),
    ).toBeTruthy();
    // Subscribe
    expect(
      document.querySelector('[data-section="inline-subscribe"]'),
    ).not.toBeNull();
    // Elsewhere
    expect(
      document.querySelector('[data-section="elsewhere"]'),
    ).not.toBeNull();
  });

  it("EDGE-002: with featuredCanon=null, From-the-canon section is hidden", () => {
    renderHome({
      todaysIssue: makeArchive("run-x", "2026-05-23"),
      featuredCanon: null,
      recentIssues: [],
    });
    expect(document.querySelector('[data-section="from-the-canon"]')).toBeNull();
  });

  it("NF-005: all external <a> tags in Today's Issue section that point off-site use rel='noopener noreferrer' target='_blank'", async () => {
    const today = makeArchive("run-today", "2026-05-23");
    renderHome({ todaysIssue: today, featuredCanon: null, recentIssues: [] });
    await waitFor(() => {
      expect(document.querySelector('[data-section="todays-issue"]')).not.toBeNull();
    });
    const offSite = document.querySelectorAll(
      '[data-section="todays-issue"] a[href^="http"]',
    );
    for (const a of Array.from(offSite)) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("NF-005: from-the-canon external link uses rel/target", () => {
    renderHome({ todaysIssue: null, featuredCanon: makeCanon(), recentIssues: [] });
    const link = document.querySelector(
      '[data-section="from-the-canon"] a[href^="http"]',
    );
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("test_REQ_041_homepage_today_plus_archives: section order is hero → today's issue → subscribe → recent issues → elsewhere with branding applied", () => {
    const today = makeArchive("run-today", "2026-05-23");
    const recent = [makeArchive("run-1", "2026-05-22"), makeArchive("run-2", "2026-05-21")];
    renderHome({ todaysIssue: today, featuredCanon: null, recentIssues: recent });

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("The daily read for people who ship with");
    const sections = Array.from(
      document.querySelectorAll("[data-section]"),
    ).map((el) => el.getAttribute("data-section"));
    expect(sections).toEqual([
      "todays-issue",
      "inline-subscribe",
      "recent-issues",
      "elsewhere",
    ]);
    // Hero precedes today's issue in the DOM.
    const todaySection = document.querySelector('[data-section="todays-issue"]');
    expect(
      h1.compareDocumentPosition(todaySection as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("test_REQ_040_public_site_uses_tenant_branding (jsdom): second tenant homepage renders its own hero slots, no AGENTLOOP string", () => {
    renderHome(
      { todaysIssue: null, featuredCanon: null, recentIssues: [] },
      SECOND_TENANT_BRANDING,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /The daily read for people building with inference\./,
      }),
    ).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/SERVING/);
    expect(body).toMatch(/QUANTIZATION/);
    expect(body).toContain(
      "No funding rounds. No leaderboards. No discourse. Just the runtime.",
    );
    expect(body).not.toMatch(/agentloop/i);
    expect(body).not.toMatch(/vertexcover/i);
  });
});
