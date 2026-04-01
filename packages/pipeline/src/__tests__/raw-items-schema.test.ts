import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { rawItems } from "@newsletter/shared/db";

// REQ-008: raw_items table exists with all required columns
describe("raw_items schema", () => {
  it("has the correct table name", () => {
    expect(getTableName(rawItems)).toBe("raw_items");
  });

  it("has all required columns", () => {
    const columns = getTableColumns(rawItems);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("sourceId");
    expect(columnNames).toContain("sourceType");
    expect(columnNames).toContain("externalId");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("url");
    expect(columnNames).toContain("sourceUrl");
    expect(columnNames).toContain("author");
    expect(columnNames).toContain("content");
    expect(columnNames).toContain("publishedAt");
    expect(columnNames).toContain("collectedAt");
    expect(columnNames).toContain("engagement");
    expect(columnNames).toContain("metadata");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
  });

  it("has id as primary key", () => {
    const columns = getTableColumns(rawItems);
    expect(columns.id.primary).toBe(true);
  });

  it("has notNull constraints on required columns", () => {
    const columns = getTableColumns(rawItems);
    expect(columns.externalId.notNull).toBe(true);
    expect(columns.title.notNull).toBe(true);
    expect(columns.url.notNull).toBe(true);
    expect(columns.collectedAt.notNull).toBe(true);
    expect(columns.engagement.notNull).toBe(true);
    expect(columns.metadata.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it("has nullable columns for optional fields", () => {
    const columns = getTableColumns(rawItems);
    expect(columns.sourceUrl.notNull).toBe(false);
    expect(columns.author.notNull).toBe(false);
    expect(columns.content.notNull).toBe(false);
    expect(columns.publishedAt.notNull).toBe(false);
  });

  it("has default values for collectedAt, engagement, metadata, createdAt, updatedAt", () => {
    const columns = getTableColumns(rawItems);
    expect(columns.collectedAt.hasDefault).toBe(true);
    expect(columns.engagement.hasDefault).toBe(true);
    expect(columns.metadata.hasDefault).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });
});
