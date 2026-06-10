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

const apiRepoFile = "/repo/packages/api/src/repositories/subscribers.ts";
const pipelineRepoFile = "/repo/packages/pipeline/src/repositories/raw-items.ts";
const apiServiceFile = "/repo/packages/api/src/services/run-service.ts";
const apiRouteFile = "/repo/packages/api/src/routes/subscribe.ts";

ruleTester.run("enforce-tenant-scope", rule, {
  valid: [
    {
      name: "non-repository file: rule does not apply",
      filename: apiServiceFile,
      code: `import { eq } from "drizzle-orm";\nimport { subscribers } from "@newsletter/shared/db";\nconst q = db.select().from(subscribers).where(eq(subscribers.id, "x"));`,
    },
    {
      name: "non-repository file: rule does not apply (routes)",
      filename: apiRouteFile,
      code: `import { eq } from "drizzle-orm";\nimport { rawItems } from "@newsletter/shared/db";\nconst q = db.select().from(rawItems);`,
    },
    {
      name: "repository: references exempt tables (users/tenants) without scope is ok",
      filename: apiRepoFile,
      code: `import { eq } from "drizzle-orm";\nimport { users, tenants } from "@newsletter/shared/db";\nconst q = db.select().from(users).where(eq(users.email, "a@b.com"));\nconst t = db.select().from(tenants);`,
    },
  ],
  invalid: [
    {
      name: "test_REQ_014_lint_rule_flags_unscoped_query: query against tenant-owned table in repo without scope",
      filename: apiRepoFile,
      code: `import { eq } from "drizzle-orm";\nimport { subscribers } from "@newsletter/shared/db";\nconst q = db.select().from(subscribers).where(eq(subscribers.id, "x"));`,
      errors: [
        {
          messageId: "unscopedTenantQuery",
        },
      ],
    },
    {
      name: "test_REQ_014: insert against tenant-owned table in repo without scope",
      filename: pipelineRepoFile,
      code: `import { rawItems } from "@newsletter/shared/db";\ndb.insert(rawItems).values({ title: "x" });`,
      errors: [
        {
          messageId: "unscopedTenantInsert",
        },
      ],
    },
    {
      name: "test_REQ_014: update against tenant-owned table in repo without scope",
      filename: apiRepoFile,
      code: `import { eq } from "drizzle-orm";\nimport { runArchives } from "@newsletter/shared/db";\ndb.update(runArchives).set({ status: "failed" }).where(eq(runArchives.id, "x"));`,
      errors: [
        {
          messageId: "unscopedTenantInsert",
        },
      ],
    },
    {
      name: "test_REQ_014: delete against tenant-owned table in repo without scope",
      filename: apiRepoFile,
      code: `import { eq } from "drizzle-orm";\nimport { subscribers } from "@newsletter/shared/db";\ndb.delete(subscribers).where(eq(subscribers.id, "x"));`,
      errors: [
        {
          messageId: "unscopedTenantInsert",
        },
      ],
    },
  ],
});
