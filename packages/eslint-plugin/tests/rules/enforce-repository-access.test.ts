import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/enforce-repository-access.js";

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

const pipelineServiceFile =
  "/repo/packages/pipeline/src/services/candidate-loader.ts";
const apiServiceFile = "/repo/packages/api/src/services/run-service.ts";
const pipelineRepoFile =
  "/repo/packages/pipeline/src/repositories/raw-items-repo.ts";
const apiRepoFile = "/repo/packages/api/src/repositories/must-read.ts";
const apiTestFile = "/repo/packages/api/tests/e2e/runs.test.ts";

ruleTester.run("enforce-repository-access", rule, {
  valid: [
    {
      name: "type-only import from @newsletter/shared/db in a service file",
      filename: pipelineServiceFile,
      code: `import type { RawItemInsert } from "@newsletter/shared/db";\nconst _x: RawItemInsert | null = null;\n`,
    },
    {
      name: "type-only import from drizzle-orm in a worker file",
      filename: pipelineServiceFile,
      code: `import type { SQL } from "drizzle-orm";\nconst _s: SQL | null = null;\n`,
    },
    {
      name: "mixed inline type-only specifiers from @newsletter/shared/db",
      filename: apiServiceFile,
      code: `import { type RawItemInsert, type AppDb } from "@newsletter/shared/db";\nconst _x: RawItemInsert | null = null;\nconst _y: AppDb | null = null;\n`,
    },
    {
      name: "value import of eq in a repository file is allowed",
      filename: pipelineRepoFile,
      code: `import { eq, and } from "drizzle-orm";\nconsole.log(eq, and);\n`,
    },
    {
      name: "value import from @newsletter/shared/db in a test file is allowed",
      filename: apiTestFile,
      code: `import { rawItems } from "@newsletter/shared/db";\nconsole.log(rawItems);\n`,
    },
    {
      name: "unrelated subpath @newsletter/shared/logger is not restricted",
      filename: pipelineServiceFile,
      code: `import { createLogger } from "@newsletter/shared/logger";\ncreateLogger();\n`,
    },
    {
      name: "type-only default import from drizzle-orm",
      filename: apiServiceFile,
      code: `import type Drizzle from "drizzle-orm";\nconst _d: Drizzle | null = null;\n`,
    },
    {
      name: "test_REQ_014: tenant-owned select scoped via tenantScoped() passes",
      filename: apiRepoFile,
      code: [
        `import { eq } from "drizzle-orm";`,
        `import { mustReadEntries, tenantScoped } from "@newsletter/shared/db";`,
        `export function findById(db, ctx, id) {`,
        `  return db.select().from(mustReadEntries).where(tenantScoped(mustReadEntries.tenantId, ctx, eq(mustReadEntries.id, id))).limit(1);`,
        `}`,
      ].join("\n"),
    },
    {
      name: "test_REQ_014: tenant-owned insert stamping tenantId passes",
      filename: pipelineRepoFile,
      code: [
        `import { rawItems, scopedTenantId } from "@newsletter/shared/db";`,
        `export function insertItem(db, ctx, item) {`,
        `  return db.insert(rawItems).values({ ...item, tenantId: scopedTenantId(ctx) });`,
        `}`,
      ].join("\n"),
    },
    {
      name: "test_REQ_014: explicit withAllTenants() escape hatch passes",
      filename: apiRepoFile,
      code: [
        `import { runArchives, tenantScoped, withAllTenants } from "@newsletter/shared/db";`,
        `export function listAll(db, superAdminCtx) {`,
        `  return db.select().from(runArchives).where(tenantScoped(runArchives.tenantId, withAllTenants(superAdminCtx)));`,
        `}`,
      ].join("\n"),
    },
    {
      name: "test_REQ_014: systemScope() trusted server-side cross-tenant escape hatch passes",
      filename: apiRepoFile,
      code: [
        `import { sesEvents } from "@newsletter/shared/db";`,
        `import { systemScope } from "@newsletter/shared/types/tenant-context";`,
        `export function upsertCrossTenant(db, scope = systemScope()) {`,
        `  return db.insert(sesEvents).values({ messageId: "m" });`,
        `}`,
      ].join("\n"),
    },
    {
      name: "test_REQ_014: non-tenant-owned table (users login lookup) needs no scope",
      filename: apiRepoFile,
      code: [
        `import { eq } from "drizzle-orm";`,
        `import { users } from "@newsletter/shared/db";`,
        `export function findByEmail(db, email) {`,
        `  return db.select().from(users).where(eq(users.email, email)).limit(1);`,
        `}`,
      ].join("\n"),
    },
    {
      name: "test_REQ_014: unscoped tenant table in a test file is exempt",
      filename: apiTestFile,
      code: [
        `import { rawItems } from "@newsletter/shared/db";`,
        `export function readAll(db) {`,
        `  return db.select().from(rawItems);`,
        `}`,
      ].join("\n"),
    },
  ],
  invalid: [
    {
      name: "REQ-051: value import of eq from drizzle-orm in a service file",
      filename: pipelineServiceFile,
      code: `import { eq } from "drizzle-orm";\nconsole.log(eq);\n`,
      errors: [
        {
          messageId: "repositoryOnly",
          data: {
            source: "drizzle-orm",
            expected: "packages/pipeline/src/repositories/",
          },
        },
      ],
    },
    {
      name: "REQ-050: value import of getDb from @newsletter/shared/db in a worker file",
      filename: pipelineServiceFile,
      code: `import { getDb } from "@newsletter/shared/db";\ngetDb();\n`,
      errors: [
        {
          messageId: "repositoryOnly",
          data: {
            source: "@newsletter/shared/db",
            expected: "packages/pipeline/src/repositories/",
          },
        },
      ],
    },
    {
      name: "REQ-050: value import of rawItems from @newsletter/shared/db in a worker file",
      filename: pipelineServiceFile,
      code: `import { rawItems } from "@newsletter/shared/db";\nconsole.log(rawItems);\n`,
      errors: [{ messageId: "repositoryOnly" }],
    },
    {
      name: "REQ-051: subpath import drizzle-orm/sql in a service file",
      filename: pipelineServiceFile,
      code: `import { sql } from "drizzle-orm/sql";\nconsole.log(sql);\n`,
      errors: [
        {
          messageId: "repositoryOnly",
          data: {
            source: "drizzle-orm/sql",
            expected: "packages/pipeline/src/repositories/",
          },
        },
      ],
    },
    {
      name: "REQ-050: subpath import @newsletter/shared/db/schema in a service file",
      filename: pipelineServiceFile,
      code: `import { runs } from "@newsletter/shared/db/schema";\nconsole.log(runs);\n`,
      errors: [{ messageId: "repositoryOnly" }],
    },
    {
      name: "REQ-053: api service file error message points to packages/api/src/repositories/",
      filename: apiServiceFile,
      code: `import { eq } from "drizzle-orm";\nconsole.log(eq);\n`,
      errors: [
        {
          messageId: "repositoryOnly",
          data: {
            source: "drizzle-orm",
            expected: "packages/api/src/repositories/",
          },
        },
      ],
    },
    {
      name: "mixed value + type specifiers still fires (at least one value specifier)",
      filename: apiServiceFile,
      code: `import { eq, type SQL } from "drizzle-orm";\nconst _s: SQL | null = null;\nconsole.log(eq);\n`,
      errors: [{ messageId: "repositoryOnly" }],
    },
    {
      name: "side-effect-only import from drizzle-orm fires (no type-only specifiers)",
      filename: apiServiceFile,
      code: `import "drizzle-orm";\n`,
      errors: [{ messageId: "repositoryOnly" }],
    },
    {
      name: "test_REQ_014_lint_rule_flags_unscoped_query: select from tenant-owned table without tenant filter",
      filename: apiRepoFile,
      code: [
        `import { eq } from "drizzle-orm";`,
        `import { mustReadEntries } from "@newsletter/shared/db";`,
        `export function findById(db, id) {`,
        `  return db.select().from(mustReadEntries).where(eq(mustReadEntries.id, id)).limit(1);`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "tenantScopeRequired", data: { table: "mustReadEntries" } }],
    },
    {
      name: "test_REQ_014: unscoped insert into tenant-owned table fires",
      filename: pipelineRepoFile,
      code: [
        `import { rawItems } from "@newsletter/shared/db";`,
        `export function insertItem(db, item) {`,
        `  return db.insert(rawItems).values(item);`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "tenantScopeRequired", data: { table: "rawItems" } }],
    },
    {
      name: "test_REQ_014: unscoped update of tenant-owned table fires",
      filename: apiRepoFile,
      code: [
        `import { eq } from "drizzle-orm";`,
        `import { subscribers } from "@newsletter/shared/db";`,
        `export function touch(db, id) {`,
        `  return db.update(subscribers).set({ status: "confirmed" }).where(eq(subscribers.id, id));`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "tenantScopeRequired", data: { table: "subscribers" } }],
    },
    {
      name: "test_REQ_014: unscoped delete from tenant-owned table fires",
      filename: apiRepoFile,
      code: [
        `import { eq } from "drizzle-orm";`,
        `import { reviewEdits } from "@newsletter/shared/db";`,
        `export function wipe(db, runId) {`,
        `  return db.delete(reviewEdits).where(eq(reviewEdits.runId, runId));`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "tenantScopeRequired", data: { table: "reviewEdits" } }],
    },
  ],
});
