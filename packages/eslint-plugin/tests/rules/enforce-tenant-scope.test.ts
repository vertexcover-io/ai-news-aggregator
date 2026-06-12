import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/enforce-tenant-scope.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
});

const apiRepoFile = "/repo/packages/api/src/repositories/must-read.ts";
const pipelineRepoFile = "/repo/packages/pipeline/src/repositories/raw-items.ts";
const apiServiceFile = "/repo/packages/api/src/services/run-service.ts";

ruleTester.run("enforce-tenant-scope", rule, {
  valid: [
    {
      name: "REQ-014: select scoped with eq(table.tenantId, tenantId)",
      filename: apiRepoFile,
      code: `
export function createMustReadRepo(db, tenantId) {
  return {
    async listAdmin() {
      return db
        .select()
        .from(mustReadEntries)
        .where(eq(mustReadEntries.tenantId, tenantId));
    },
  };
}
`,
    },
    {
      name: "REQ-014: insert scoped by spreading tenantId into values",
      filename: apiRepoFile,
      code: `
export function createEmailSendsRepo(db, tenantId) {
  return {
    async create(insert) {
      const [row] = await db
        .insert(emailSends)
        .values({ ...insert, tenantId })
        .returning();
      return row;
    },
  };
}
`,
    },
    {
      name: "REQ-014: update scoped with and(eq(table.tenantId, tenantId), ...)",
      filename: apiRepoFile,
      code: `
export function createMustReadRepo(db, tenantId) {
  return {
    async update(id, patch) {
      return db
        .update(mustReadEntries)
        .set(patch)
        .where(and(eq(mustReadEntries.tenantId, tenantId), eq(mustReadEntries.id, id)))
        .returning();
    },
  };
}
`,
    },
    {
      name: "REQ-014: delete scoped with tenantId",
      filename: pipelineRepoFile,
      code: `
export function createRawItemsRepo(db, tenantId) {
  return {
    async deleteForRun(runId) {
      await db
        .delete(rawItems)
        .where(and(eq(rawItems.tenantId, tenantId), eq(rawItems.runId, runId)));
    },
  };
}
`,
    },
    {
      name: "where clause precomputed in the same method still counts as scoped",
      filename: apiRepoFile,
      code: `
export function createRunArchivesRepo(db, tenantId) {
  return {
    async listReviewed() {
      const where = and(eq(runArchives.tenantId, tenantId), eq(runArchives.reviewed, true));
      const rows = await db.select().from(runArchives).where(where);
      const [countRow] = await db.select({ count: sql\`count(*)\` }).from(runArchives).where(where);
      return { rows, total: countRow.count };
    },
  };
}
`,
    },
    {
      name: "raw sql execute that filters on tenant_id is scoped",
      filename: apiRepoFile,
      code: `
export function createRunArchivesRepo(db, tenantId) {
  return {
    async search(q) {
      return db.execute(sql\`select id from run_archives where tenant_id = \${tenantId}\`);
    },
  };
}
`,
    },
    {
      name: "exempt table: users is not tenant-owned, unscoped query allowed",
      filename: "/repo/packages/api/src/repositories/users.ts",
      code: `
export function createUsersRepo(db) {
  return {
    async findByEmail(email) {
      return db.select().from(users).where(eq(users.email, email));
    },
  };
}
`,
    },
    {
      name: "non-repository file is ignored entirely",
      filename: apiServiceFile,
      code: `
export async function loadAll(db) {
  return db.select().from(rawItems);
}
`,
    },
    {
      name: "allowlisted global tenancy-resolution lookup is exempt",
      filename: "/repo/packages/api/src/repositories/subscribers.ts",
      options: [{ allowInFunctions: ["createSubscriberTenantLookup"] }],
      code: `
export function createSubscriberTenantLookup(db) {
  return {
    async findById(id) {
      return db.select().from(subscribers).where(eq(subscribers.id, id));
    },
  };
}
`,
    },
    {
      name: "tables option overrides the default tenant-owned list",
      filename: apiRepoFile,
      code: `
export function createRawItemsRepo(db) {
  return {
    async listAll() {
      return db.select().from(rawItems);
    },
  };
}
`,
      options: [{ tables: ["runArchives"] }],
    },
    {
      name: "file-scoped allowlist entry exempts the factory in its own file",
      filename: "/repo/packages/api/src/repositories/subscribers.ts",
      options: [
        { allowInFunctions: ["subscribers.ts#createSubscriberTenantLookup"] },
      ],
      code: `
export function createSubscriberTenantLookup(db) {
  return {
    async findById(id) {
      return db.select().from(subscribers).where(eq(subscribers.id, id));
    },
  };
}
`,
    },
    {
      name: "relational findMany scoped with tenantId is allowed",
      filename: pipelineRepoFile,
      code: `
export function createRawItemsRepo(db, tenantId) {
  return {
    async listForTenant() {
      return db.query.rawItems.findMany({ where: eq(rawItems.tenantId, tenantId) });
    },
  };
}
`,
    },
    {
      name: "query on a table outside the tenant-owned list is ignored",
      filename: "/repo/packages/api/src/repositories/tenants.ts",
      code: `
export function createTenantsRepo(db) {
  return {
    async findBySlug(slug) {
      return db.select().from(tenants).where(eq(tenants.slug, slug));
    },
  };
}
`,
    },
  ],
  invalid: [
    {
      name: "REQ-014: select on tenant-owned table without tenantId in where",
      filename: pipelineRepoFile,
      code: `
export function createRawItemsRepo(db) {
  return {
    async findById(id) {
      return db.select().from(rawItems).where(eq(rawItems.id, id));
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "rawItems" } }],
    },
    {
      name: "REQ-014: insert without tenantId spread",
      filename: "/repo/packages/api/src/repositories/subscribers.ts",
      code: `
export function createSubscribersRepo(db) {
  return {
    async create(input) {
      const [row] = await db.insert(subscribers).values({ email: input.email }).returning();
      return row;
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "subscribers" } }],
    },
    {
      name: "REQ-014: update without tenant scope",
      filename: apiRepoFile,
      code: `
export function createRunArchivesRepo(db) {
  return {
    async markReviewed(id) {
      return db.update(runArchives).set({ reviewed: true }).where(eq(runArchives.id, id));
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "runArchives" } }],
    },
    {
      name: "REQ-014: delete without tenant scope",
      filename: pipelineRepoFile,
      code: `
export function createCandidatesRepo(db) {
  return {
    async deleteForRun(runId) {
      await db.delete(candidates).where(eq(candidates.runId, runId));
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "candidates" } }],
    },
    {
      name: "REQ-014: select with no where clause at all",
      filename: apiRepoFile,
      code: `
export function createEvalRunsRepo(db) {
  return {
    async listAll() {
      return db.select().from(evalRuns);
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "evalRuns" } }],
    },
    {
      name: "REQ-014: raw sql execute touching a tenant-owned table without tenant_id",
      filename: pipelineRepoFile,
      code: `
export function createRawItemsRepo(db) {
  return {
    async purge() {
      await db.execute(sql\`delete from raw_items\`);
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "raw_items" } }],
    },
    {
      name: "allowlist only exempts the named function, not siblings",
      filename: "/repo/packages/api/src/repositories/subscribers.ts",
      options: [{ allowInFunctions: ["createSubscriberTenantLookup"] }],
      code: `
export function createSubscribersRepo(db) {
  return {
    async findById(id) {
      return db.select().from(subscribers).where(eq(subscribers.id, id));
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "subscribers" } }],
    },
    {
      name: "a comment mentioning tenant_id does not disarm the rule",
      filename: apiRepoFile,
      code: `
export function createRawItemsRepo(db) {
  return {
    async purgeAll() {
      // tenant_id is resolved upstream, tenantId not needed here
      await db.delete(rawItems);
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "rawItems" } }],
    },
    {
      name: "relational findMany without tenant scope is flagged",
      filename: pipelineRepoFile,
      code: `
export function createRawItemsRepo(db) {
  return {
    async listAll() {
      return db.query.rawItems.findMany();
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "rawItems" } }],
    },
    {
      name: "file-scoped allowlist entry does not leak to other files",
      filename: pipelineRepoFile,
      options: [
        { allowInFunctions: ["subscribers.ts#createSubscriberTenantLookup"] },
      ],
      code: `
export function createSubscriberTenantLookup(db) {
  return {
    async purge() {
      await db.delete(rawItems);
    },
  };
}
`,
      errors: [{ messageId: "unscopedQuery", data: { table: "rawItems" } }],
    },
  ],
});
