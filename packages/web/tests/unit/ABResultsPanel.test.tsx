import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ABResultsPanel,
  type AbItem,
} from "../../src/components/eval/ABResultsPanel";

afterEach(() => {
  cleanup();
});

const saved: AbItem[] = [
  {
    rank: 1,
    rawItemId: 1,
    title: "Saved top item",
    source: "hn",
    url: "https://x/1",
  },
];
const draft: AbItem[] = [
  {
    rank: 1,
    rawItemId: 2,
    title: "Draft top item",
    source: "reddit",
    url: "https://x/2",
  },
];

describe("ABResultsPanel", () => {
  it("renders two columns with items", () => {
    render(<ABResultsPanel saved={saved} draft={draft} />);
    const savedCol = screen.getByTestId("ab-saved");
    const draftCol = screen.getByTestId("ab-draft");
    expect(savedCol.textContent).toContain("Saved top item");
    expect(draftCol.textContent).toContain("Draft top item");
  });

  it("renders empty when both lists are empty", () => {
    render(<ABResultsPanel saved={[]} draft={[]} />);
    const items = screen.queryAllByTestId("ab-item");
    expect(items).toHaveLength(0);
  });
});
