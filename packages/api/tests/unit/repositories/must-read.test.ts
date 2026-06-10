import { describe, expect, it } from "vitest";
import { toPublicWire } from "@api/repositories/must-read.js";
import type { MustReadPublicEntry } from "@api/repositories/must-read.js";

// Regression guard for the P1 tenancy migration: must_read_entries gained a
// nullable tenant_id column; the public projection must keep excluding
// internal columns (updatedAt, tenantId) from the wire shape.
describe("must-read repository public projection", () => {
  it("serializes the public wire shape without internal columns", () => {
    const row: MustReadPublicEntry = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      url: "https://example.com/paper",
      title: "A Must Read",
      author: "alice",
      year: 2024,
      annotation: "Why it matters",
      addedAt: new Date("2026-06-01T00:00:00.000Z"),
    };

    const wire = toPublicWire(row);

    expect(wire).toEqual({
      id: row.id,
      url: row.url,
      title: row.title,
      author: "alice",
      year: 2024,
      annotation: "Why it matters",
      addedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(Object.keys(wire)).not.toContain("tenantId");
    expect(Object.keys(wire)).not.toContain("updatedAt");
  });
});
