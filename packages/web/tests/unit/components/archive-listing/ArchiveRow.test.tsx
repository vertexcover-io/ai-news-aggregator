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
    ...overrides,
  };
}

describe("ArchiveRow", () => {
  afterEach(cleanup);
  // REQ-013: date block — day-of-week, MMM D, YYYY · N°X
  it("REQ-013: renders day-of-week eyebrow, MMM D date, and issue number sub", () => {
    renderRow(makeItem({ runDate: "2026-04-18" }), 42, false);
    // April 18, 2026 is a Saturday
    expect(screen.getByText("SAT")).toBeTruthy();
    expect(screen.getByText("Apr 18")).toBeTruthy();
    expect(screen.getByText("2026 · N°42")).toBeTruthy();
  });

  // REQ-013: issueNumber derived correctly at other indices
  it("REQ-013: issue number N°80 when total=82 and index=2", () => {
    renderRow(makeItem({ runDate: "2026-04-18" }), 80, false);
    expect(screen.getByText("2026 · N°80")).toBeTruthy();
  });

  // REQ-014: headline text equals topItems[0].title in full (no truncation)
  it("REQ-014: headline equals topItems[0].title in full", () => {
    const longTitle = "A very long headline that goes on and on and on";
    renderRow(
      makeItem({ topItems: [{ id: 1, title: longTitle, sourceType: "hn" }] }),
      1,
      false,
    );
    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe(longTitle);
  });

  // REQ-014: chips render topItems titles (truncated when > 28 chars)
  it("REQ-014: chips render topItems titles with truncation for > 28 chars", () => {
    const longTitle = "A very long headline that goes on and on";
    renderRow(
      makeItem({
        topItems: [{ id: 1, title: longTitle, sourceType: "hn" }],
        storyCount: 1,
      }),
      1,
      false,
    );
    // chip should show truncated text (27 chars + …)
    const expectedChipText = longTitle.slice(0, 27) + "\u2026";
    expect(screen.getByText(expectedChipText)).toBeTruthy();
  });

  // REQ-014: "+ N more" when storyCount > topItems.length
  it("REQ-014: renders '+ N more' when storyCount > topItems.length", () => {
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
    expect(screen.getByText("+ 5 more")).toBeTruthy();
  });

  // REQ-015: chip has title attribute equal to full untruncated title
  it("REQ-015: chip title attribute equals full untruncated title", () => {
    const longTitle = "A very long headline that goes on and on";
    const { container } = renderRow(
      makeItem({
        topItems: [{ id: 1, title: longTitle, sourceType: "hn" }],
        storyCount: 1,
      }),
      1,
      false,
    );
    const chips = container.querySelectorAll("li[title]");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].getAttribute("title")).toBe(longTitle);
  });

  // REQ-016: Read link href = /archive/{runId}
  it("REQ-016: Read link href equals /archive/{runId}", () => {
    renderRow(makeItem({ runId: "abc-123" }), 1, false);
    const link = screen.getByRole("link", { name: /Read/i });
    expect(link.getAttribute("href")).toBe("/archive/abc-123");
  });

  // REQ-017: featured=true → data-featured="true" and dek element with leadSummary
  it("REQ-017: featured=true sets data-featured=true and renders dek", () => {
    const { container } = renderRow(
      makeItem({ leadSummary: "This is the lead summary text" }),
      1,
      true,
    );
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBe("true");
    expect(screen.getByText("This is the lead summary text")).toBeTruthy();
  });

  // REQ-017: featured=false → no data-featured, no dek
  it("REQ-017: featured=false has no data-featured attribute and no dek", () => {
    const { container } = renderRow(
      makeItem({ leadSummary: "This is the lead summary text" }),
      2,
      false,
    );
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBeNull();
    expect(screen.queryByText("This is the lead summary text")).toBeNull();
  });

  // REQ-029: storyCount=0, topItems=[] → "No stories", no chip row, no Read link
  it("REQ-029: storyCount=0 renders 'No stories', no chips, no Read link", () => {
    const { container } = renderRow(
      makeItem({ storyCount: 0, topItems: [], runId: "zero-stories" }),
      1,
      false,
    );
    expect(screen.getByText("No stories")).toBeTruthy();
    expect(container.querySelectorAll("li[title]").length).toBe(0);
    expect(screen.queryByRole("link", { name: /Read/i })).toBeNull();
  });

  // REQ-030: topItems.length=2, storyCount=2 → 2 chips, no "+" more
  it("REQ-030: exactly 2 chips and no '+ N more' when storyCount === topItems.length", () => {
    const { container } = renderRow(
      makeItem({
        topItems: [
          { id: 1, title: "Story 1", sourceType: "hn" },
          { id: 2, title: "Story 2", sourceType: "reddit" },
        ],
        storyCount: 2,
      }),
      1,
      false,
    );
    const chips = container.querySelectorAll("li[title]");
    expect(chips.length).toBe(2);
    expect(screen.queryByText(/\+ \d+ more/)).toBeNull();
  });

  // REQ-031: topItems.length=2, storyCount=5 → 2 chips + "+"
  it("REQ-031: 2 chips + '+ 3 more' when topItems.length=2 and storyCount=5", () => {
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
    const chips = container.querySelectorAll("li[title]");
    expect(chips.length).toBe(2);
    expect(screen.getByText("+ 3 more")).toBeTruthy();
  });

  // EDGE-005: featured=true with leadSummary="" — no dek element
  it("EDGE-005: no dek rendered when featured=true but leadSummary is empty string", () => {
    const { container } = renderRow(makeItem({ leadSummary: "" }), 1, true);
    const row = container.querySelector("li");
    // data-featured is from featured prop
    expect(row?.getAttribute("data-featured")).toBe("true");
    // leadSummary="" → no <p> with dek content
    const paras = container.querySelectorAll("p");
    expect(paras.length).toBe(0);
  });

  // EDGE-006: featured=true, leadSummary=null — no dek element
  it("EDGE-006: no dek rendered when featured=true but leadSummary is null", () => {
    const { container } = renderRow(makeItem({ leadSummary: null }), 1, true);
    const row = container.querySelector("li");
    expect(row?.getAttribute("data-featured")).toBe("true");
    const paras = container.querySelectorAll("p");
    expect(paras.length).toBe(0);
  });

  // EDGE-007 / EDGE-013: topItems=[], storyCount>0 → headline "—", no chips, Read link present
  it("EDGE-007 / EDGE-013: topItems=[], storyCount>0 → headline '—', no chips, Read link present", () => {
    const { container } = renderRow(
      makeItem({ topItems: [], storyCount: 3, runId: "run-missing" }),
      1,
      false,
    );
    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe("\u2014"); // em dash
    expect(container.querySelectorAll("li[title]").length).toBe(0);
    expect(screen.getByRole("link", { name: /Read/i })).toBeTruthy();
  });

  // EDGE-010: chip title 20 chars → no truncation
  it("EDGE-010: chip title < 28 chars is not truncated", () => {
    const title = "Short 20 char title!"; // 20 chars
    expect(title.length).toBe(20);
    const { container } = renderRow(
      makeItem({
        topItems: [{ id: 1, title, sourceType: "hn" }],
        storyCount: 1,
      }),
      1,
      false,
    );
    // Chip is a <li title="...">; check the chip element specifically
    const chip = container.querySelector(`li[title="${title}"]`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe(title);
  });

  // EDGE-011: chip title exactly 28 chars → no truncation
  it("EDGE-011: chip title exactly 28 chars is not truncated", () => {
    const title = "Exactly twenty-eight chars!!"; // 28 chars
    expect(title.length).toBe(28);
    const { container } = renderRow(
      makeItem({
        topItems: [{ id: 1, title, sourceType: "hn" }],
        storyCount: 1,
      }),
      1,
      false,
    );
    const chip = container.querySelector(`li[title="${title}"]`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe(title);
  });

  // EDGE-012: chip title 29 chars → truncated to 27 + "…" (28 code points total)
  it("EDGE-012: chip title 29 chars is truncated to 28 visible code points with '…'", () => {
    const title = "Exactly twenty-nine chars!!!!"; // 29 chars
    expect(title.length).toBe(29);
    const { container } = renderRow(
      makeItem({
        topItems: [{ id: 1, title, sourceType: "hn" }],
        storyCount: 1,
      }),
      1,
      false,
    );
    const expected = title.slice(0, 27) + "\u2026";
    expect(expected.length).toBe(28);
    // chip title attribute = full title, textContent = truncated
    const chip = container.querySelector(`li[title="${title}"]`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe(expected);
  });
});
