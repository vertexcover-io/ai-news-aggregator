import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArchiveRow } from "../../../../src/components/archive-listing/ArchiveRow";
import type { ArchiveListItem } from "@newsletter/shared";

function renderRow(
  item: ArchiveListItem,
  issueNumber: number,
  featured: boolean,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ul>
        <ArchiveRow item={item} issueNumber={issueNumber} featured={featured} />
      </ul>
    </MemoryRouter>,
  );
}

function makeItem(overrides: Partial<ArchiveListItem> = {}): ArchiveListItem {
  return {
    runId: "run-001",
    runDate: "2026-04-18",
    storyCount: 5,
    topItems: [
      { id: 1, title: "Top story title", sourceType: "hn" },
      { id: 2, title: "Second story", sourceType: "reddit" },
      { id: 3, title: "Third story", sourceType: "rss" },
    ],
    leadSummary: null,
    digestHeadline: null,
    digestSummary: null,
    ...overrides,
  };
}

describe("ArchiveRow", () => {
  afterEach(cleanup);

  // Mock-A: date block — day-of-week, MMM D, YYYY (no N°)
  it("Mock-A: renders day-of-week eyebrow, MMM D date, and year (no issue number)", () => {
    renderRow(makeItem({ runDate: "2026-04-18" }), 42, false);
    // April 18, 2026 is a Saturday
    expect(screen.getByText("SAT")).toBeTruthy();
    expect(screen.getByText("Apr 18")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.queryByText(/N°/)).toBeNull();
  });

  // VER-96: chip row removed; no <ul> appears inside the row content area
  it("VER-96: no chip <ul> rendered (chips removed in this PR)", () => {
    const { container } = renderRow(
      makeItem({
        topItems: [
          { id: 1, title: "Story 1", sourceType: "hn" },
          { id: 2, title: "Story 2", sourceType: "reddit" },
        ],
        storyCount: 5,
      }),
      1,
      false,
    );
    // The outer <ul> is the test wrapper; inside the row's content there
    // should be no <ul>.
    const li = container.querySelector("li");
    const inner = li?.querySelector("ul");
    expect(inner).toBeNull();
  });

  // VER-96: no "+ N more" text appears in the row
  it("VER-96: no '+ N more' text rendered", () => {
    renderRow(
      makeItem({
        topItems: [
          { id: 1, title: "Story 1", sourceType: "hn" },
          { id: 2, title: "Story 2", sourceType: "reddit" },
        ],
        storyCount: 7,
      }),
      1,
      false,
    );
    expect(screen.queryByText(/\+ \d+ more/)).toBeNull();
  });

  it("headline equals the first story title when digestHeadline differs", () => {
    renderRow(
      makeItem({
        digestHeadline: "AI safety, regulation, and open models",
      }),
      1,
      false,
    );
    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe("Top story title");
  });

  // VER-96: headline falls back to topItems[0].title when digestHeadline null
  it("VER-96: headline falls back to topItems[0].title when digestHeadline is null", () => {
    const longTitle = "A very long top-story headline";
    renderRow(
      makeItem({
        digestHeadline: null,
        topItems: [{ id: 1, title: longTitle, sourceType: "hn" }],
      }),
      1,
      false,
    );
    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe(longTitle);
  });

  // REQ-016: Read link href = /archive/{runId}
  it("REQ-016: Read link href equals /archive/{runId}", () => {
    renderRow(makeItem({ runId: "abc-123" }), 1, false);
    const link = screen.getByRole("link", { name: /Read/i });
    expect(link.getAttribute("href")).toBe("/archive/abc-123");
  });

  // VER-96: featured row prefers digestSummary over leadSummary
  it("VER-96: featured row prefers digestSummary over leadSummary", () => {
    renderRow(
      makeItem({
        leadSummary: "Lead summary fallback text",
        digestSummary: "Digest summary describing today's stories",
      }),
      1,
      true,
    );
    expect(screen.getByText("Digest summary describing today's stories")).toBeTruthy();
    expect(screen.queryByText("Lead summary fallback text")).toBeNull();
  });

  // REQ-017: featured=true with leadSummary still renders dek when digestSummary is null
  it("REQ-017: featured=true with leadSummary set renders dek when digestSummary is null", () => {
    const { container } = renderRow(
      makeItem({
        leadSummary: "This is the lead summary text",
        digestSummary: null,
      }),
      1,
      true,
    );
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBe("true");
    expect(screen.getByText("This is the lead summary text")).toBeTruthy();
  });

  // VER-96: non-featured row renders dek when digestSummary present
  it("VER-96: non-featured row renders dek when digestSummary is set", () => {
    renderRow(
      makeItem({
        digestSummary: "Day's digest summary visible on non-featured rows",
      }),
      2,
      false,
    );
    expect(
      screen.getByText("Day's digest summary visible on non-featured rows"),
    ).toBeTruthy();
  });

  // REQ-017: featured=false with only leadSummary → no dek (preserves original hierarchy)
  it("REQ-017: featured=false with only leadSummary set → no dek rendered", () => {
    const { container } = renderRow(
      makeItem({
        leadSummary: "Lead summary that should not appear here",
        digestSummary: null,
      }),
      2,
      false,
    );
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBeNull();
    expect(
      screen.queryByText("Lead summary that should not appear here"),
    ).toBeNull();
  });

  // REQ-029: storyCount=0, topItems=[] → "No stories", no Read link
  it("REQ-029: storyCount=0 renders 'No stories' and no Read link", () => {
    renderRow(
      makeItem({ storyCount: 0, topItems: [], runId: "zero-stories" }),
      1,
      false,
    );
    expect(screen.getByText("No stories")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Read/i })).toBeNull();
  });

  // EDGE-005: featured=true with leadSummary="" and digestSummary=null — no dek paragraph in body slot
  it("EDGE-005: no dek rendered when featured=true but both summaries are empty/null", () => {
    const { container } = renderRow(
      makeItem({ leadSummary: "", digestSummary: null }),
      1,
      true,
    );
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBe("true");
    expect(container.querySelector("[data-slot='dek']")).toBeNull();
  });

  // EDGE-006: featured=true, leadSummary=null, digestSummary=null — no dek
  it("EDGE-006: no dek rendered when featured=true but both summaries are null", () => {
    const { container } = renderRow(
      makeItem({ leadSummary: null, digestSummary: null }),
      1,
      true,
    );
    expect(container.querySelector("[data-slot='dek']")).toBeNull();
  });

  // EDGE-007 / EDGE-013: topItems=[], storyCount>0 → headline falls back to topItems[0]?.title (undefined → "—"), Read link present
  it("EDGE-007 / EDGE-013: topItems=[], storyCount>0 → headline '—', Read link present", () => {
    renderRow(
      makeItem({
        topItems: [],
        storyCount: 3,
        runId: "run-missing",
        digestHeadline: null,
      }),
      1,
      false,
    );
    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe("—"); // em dash
    expect(screen.getByRole("link", { name: /Read/i })).toBeTruthy();
  });

  // VER-96: empty-string digestSummary suppresses dek (does not fall back to leadSummary)
  it("VER-96: empty-string digestSummary renders no dek on featured row", () => {
    const { container } = renderRow(
      makeItem({
        digestSummary: "",
        leadSummary: "Should not appear because digestSummary is set (empty)",
      }),
      1,
      true,
    );
    expect(container.querySelector("[data-slot='dek']")).toBeNull();
  });

  it("highlights terms in the first story headline", () => {
    const { container } = render(
      <MemoryRouter>
        <ul>
          <ArchiveRow
            item={makeItem({
              digestHeadline: "Different digest headline",
              topItems: [{ id: 1, title: "Agentic systems break out", sourceType: "hn" }],
            })}
            issueNumber={1}
            featured={false}
            highlightTerms={["agentic"]}
          />
        </ul>
      </MemoryRouter>,
    );
    const marks = container.querySelectorAll("h3 mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("Agentic");
  });

  // Phase 5: highlightTerms wraps matches in <mark> in dek (digestSummary)
  it("highlights terms in the dek", () => {
    const { container } = render(
      <MemoryRouter>
        <ul>
          <ArchiveRow
            item={makeItem({
              digestHeadline: "Story",
              digestSummary: "How teams plan agentic workloads today",
            })}
            issueNumber={1}
            featured={false}
            highlightTerms={["agentic"]}
          />
        </ul>
      </MemoryRouter>,
    );
    const marks = container.querySelectorAll("p mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("agentic");
  });

  // Phase 5: empty highlightTerms renders no <mark>
  it("renders no <mark> when highlightTerms is empty", () => {
    const { container } = render(
      <MemoryRouter>
        <ul>
          <ArchiveRow
            item={makeItem({ digestHeadline: "Agentic systems" })}
            issueNumber={1}
            featured={false}
            highlightTerms={[]}
          />
        </ul>
      </MemoryRouter>,
    );
    expect(container.querySelector("mark")).toBeNull();
  });
});
