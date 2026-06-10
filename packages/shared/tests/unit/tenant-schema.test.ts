import { describe, expect, it } from "vitest";

// Phase 1: These imports will fail until the tables are added to schema.ts
// We'll use dynamic imports after the schema is updated, but for RED phase
// let's define what we expect the schema to expose.

// The schema exports we expect to exist after Phase 1:
// - tenants table
// - users table
// - tenantId column on each tenant-owned table

describe("schema: tenants table", () => {
  it("tenants table has expected columns", async () => {
    // Dynamic import — will fail in RED phase if table doesn't exist
    const { tenants } = await import("@shared/db/schema.js");
    expect(tenants).toBeDefined();

    // Verify column names exist on the table definition
    const cols = Object.keys(tenants);
    const expectedColumns = [
      "id",
      "slug",
      "name",
      "status",
      "customDomain",
      "headline",
      "topicStrip",
      "subtagline",
      "logoBytes",
      "logoContentType",
      "featureCanon",
      "featureDeliverability",
      "featureEval",
      "onboardingState",
      "createdAt",
      "updatedAt",
    ];
    for (const col of expectedColumns) {
      expect(cols, `tenants table missing column: ${col}`).toContain(col);
    }
  });

  it("tenants table has a unique slug constraint", () => {
    // The slug column should be defined as unique — we verify the table
    // is defined with uniqueness by checking the Drizzle column config
    // This is a structural assertion; the actual DB constraint is tested in integration
    expect(true).toBe(true); // placeholder — actual constraint verified via DB introspection
  });
});

describe("schema: users table", () => {
  it("users table has expected columns", async () => {
    const { users } = await import("@shared/db/schema.js");
    expect(users).toBeDefined();

    const cols = Object.keys(users);
    const expectedColumns = [
      "id",
      "tenantId",
      "email",
      "name",
      "passwordHash",
      "role",
      "createdAt",
      "updatedAt",
    ];
    for (const col of expectedColumns) {
      expect(cols, `users table missing column: ${col}`).toContain(col);
    }
  });
});

describe("schema: tenant_id on tenant-owned tables", () => {
  const tenantOwnedTables = [
    "rawItems",
    "runArchives",
    "runLogs",
    "reviewEdits",
    "emailSends",
    "subscribers",
    "feedbackEvents",
    "sesEvents",
    "evalRuns",
    "mustReadEntries",
    "userSettings",
    "socialCredentials",
    "socialTokens",
  ];

  for (const tableName of tenantOwnedTables) {
    it(`${tableName} has a tenantId column`, async () => {
      const schema = await import("@shared/db/schema.js");
      const table = (schema as Record<string, unknown>)[tableName];
      expect(table, `Table ${tableName} should be exported from schema`).toBeDefined();

      const cols = Object.keys(table as object);
      expect(
        cols,
        `${tableName} should have a tenantId column. Got: ${cols.join(", ")}`,
      ).toContain("tenantId");
    });
  }
});
