import { describe, expect, it } from "vitest";
import { computeUnsavedCount } from "../../../src/pages/ReviewPage";

interface Item { id: number; title: string; imageUrl: string | null | undefined; recap?: { summary?: string; bottomLine?: string; bullets?: string[] } | null }

function makeItem(id: number, overrides: Partial<Item> = {}): Item {
  return { id, title: `Item ${String(id)}`, imageUrl: null, recap: null, ...overrides };
}

function makeState(initial: Item[], current: Item[], pending: unknown[] = [], pendingPromotes: unknown[] = []) {
  return { initial, current, pending, pendingPromotes };
}

describe("computeUnsavedCount", () => {
  it("returns 0 for identical states", () => {
    const items = [makeItem(1), makeItem(2)];
    expect(computeUnsavedCount(makeState(items, items))).toBe(0);
  });

  it("counts added items", () => {
    const initial = [makeItem(1)];
    const current = [makeItem(1), makeItem(2)];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts removed items", () => {
    const initial = [makeItem(1), makeItem(2)];
    const current = [makeItem(1)];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts a reorder as 1", () => {
    const initial = [makeItem(1), makeItem(2), makeItem(3)];
    const current = [makeItem(2), makeItem(1), makeItem(3)];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts pending items", () => {
    const items = [makeItem(1)];
    expect(computeUnsavedCount(makeState(items, items, [{}, {}]))).toBe(2);
  });

  it("counts title field edit", () => {
    const initial = [makeItem(1, { title: "original" })];
    const current = [makeItem(1, { title: "changed" })];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts imageUrl field edit", () => {
    const initial = [makeItem(1, { imageUrl: null })];
    const current = [makeItem(1, { imageUrl: "https://img.example.com/photo.jpg" })];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts recap.summary edit", () => {
    const initial = [makeItem(1, { recap: { summary: "old", bottomLine: "", bullets: [] } })];
    const current = [makeItem(1, { recap: { summary: "new", bottomLine: "", bullets: [] } })];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("counts bullets length change", () => {
    const initial = [makeItem(1, { recap: { summary: "", bottomLine: "", bullets: ["a"] } })];
    const current = [makeItem(1, { recap: { summary: "", bottomLine: "", bullets: ["a", "b"] } })];
    expect(computeUnsavedCount(makeState(initial, current))).toBe(1);
  });

  it("accumulates multiple change types", () => {
    const initial = [makeItem(1), makeItem(2)];
    const current = [makeItem(1, { title: "changed" }), makeItem(3)];
    // 1 field edit (title on id=1) + 1 removed (id=2) + 1 added (id=3) = 3
    expect(computeUnsavedCount(makeState(initial, current))).toBe(3);
  });
});
