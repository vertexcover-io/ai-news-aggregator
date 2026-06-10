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

const repoFile = "/repo/packages/pipeline/src/repositories/raw-items-repo.ts";
const serviceFile = "/repo/packages/pipeline/src/services/candidate-loader.ts";

const options: [
  { tenantOwnedTables: string[]; appLevelTables: string[] },
] = [
  {
    tenantOwnedTables: ["raw_items", "run_archives", "subscribers"],
    appLevelTables: ["tenants", "users"],
  },
];

ruleTester.run("enforce-tenant-scope", rule, {
  valid: [
    {
      name: "non-repository file is ignored entirely",
      filename: serviceFile,
      options,
      code: `import { rawItems } from "@newsletter/shared/db";\nexport const get = (db) => db.select().from(rawItems);\n`,
    },
    {
      name: "scoped query with .where in the chain is clean",
      filename: repoFile,
      options,
      code: `import { rawItems } from "@newsletter/shared/db";\nimport { tenantScope } from "@newsletter/shared/db";\nexport const createRawItemsRepo = (db, ctx) => ({\n  list: () => {\n    const scope = tenantScope(rawItems.tenantId, ctx);\n    return db.select().from(rawItems).where(scope.where());\n  },\n});\n`,
    },
    {
      name: "factory declaring ctx param does not need explicit warning",
      filename: repoFile,
      options,
      code: `import { rawItems } from "@newsletter/shared/db";\nexport const createRawItemsRepo = (db, ctx) => ({\n  count: () => db.select().from(rawItems).where(eq(1, 1)),\n});\n`,
    },
    {
      name: "app-level table is not tenant-owned, unscoped query is fine",
      filename: repoFile,
      options,
      code: `import { tenants } from "@newsletter/shared/db";\nexport const createTenantsRepo = (db) => ({\n  all: () => db.select().from(tenants),\n});\n`,
    },
    {
      name: "raw sql with tenant_id predicate is clean",
      filename: repoFile,
      options,
      code: `import { sql } from "drizzle-orm";\nexport const createRawItemsRepo = (db, ctx) =>\n  db.execute(sql\`select * from raw_items where tenant_id = \${ctx.tenantId}\`);\n`,
    },
  ],
  invalid: [
    {
      name: "factory touching tenant-owned table without ctx param warns",
      filename: repoFile,
      options,
      code: `import { rawItems } from "@newsletter/shared/db";\nexport const createRawItemsRepo = (db) => ({\n  all: () => db.select().from(rawItems).where(eq(1, 1)),\n});\n`,
      errors: [
        {
          messageId: "missingCtxParam",
          data: { factory: "createRawItemsRepo", table: "raw_items" },
        },
      ],
    },
    {
      name: "unscoped .from(tenantTable) with no .where in chain warns",
      filename: repoFile,
      options,
      code: `import { runArchives } from "@newsletter/shared/db";\nexport const createArchivesRepo = (db, ctx) => ({\n  list: () => db.select().from(runArchives),\n});\n`,
      errors: [
        {
          messageId: "unscopedQuery",
          data: { table: "run_archives" },
        },
      ],
    },
    {
      name: "raw sql FROM tenant-owned table without tenant_id warns",
      filename: repoFile,
      options,
      code: `import { sql } from "drizzle-orm";\nexport const createSubscribersRepo = (db, ctx) =>\n  db.execute(sql\`select id from subscribers where active = true\`);\n`,
      errors: [
        {
          messageId: "rawSqlMissingTenant",
          data: { table: "subscribers" },
        },
      ],
    },
  ],
});
