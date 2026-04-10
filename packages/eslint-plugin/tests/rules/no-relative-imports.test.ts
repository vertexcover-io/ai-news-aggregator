import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/no-relative-imports.js";

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

const apiRouteFile = "/repo/packages/api/src/routes/runs.ts";
const apiRepoFile = "/repo/packages/api/src/repositories/raw-items.ts";
const apiTestFile = "/repo/packages/api/src/services/foo.test.ts";
const pipelineFile = "/repo/packages/pipeline/src/workers/run.ts";
const sharedFile = "/repo/packages/shared/src/db/index.ts";
const webFile = "/repo/packages/web/src/api/runs.ts";
const pluginFile = "/repo/packages/eslint-plugin/src/rules/foo.ts";

ruleTester.run("no-relative-imports", rule, {
  valid: [
    {
      name: "REQ-007: same-dir import ./schema.js in api route file",
      filename: apiRouteFile,
      code: `import { schema } from "./schema.js";`,
    },
    {
      name: "REQ-008 / EDGE-006: same-dir import ./client in web file",
      filename: webFile,
      code: `import { apiFetch } from "./client";`,
    },
    {
      name: "REQ-008 / EDGE-007: export * from ./schema.js in shared file",
      filename: sharedFile,
      code: `export * from "./schema.js";`,
    },
    {
      name: "REQ-008 / EDGE-008: import ./rules/foo.js in eslint-plugin file",
      filename: pluginFile,
      code: `import collectorReturnShape from "./rules/collector-return-shape.js";`,
    },
    {
      name: "no false positive on workspace import @newsletter/shared",
      filename: apiRouteFile,
      code: `import { something } from "@newsletter/shared";`,
    },
  ],
  invalid: [
    {
      name: "REQ-001, REQ-004, REQ-005, REQ-006, REQ-011: ../lib/validate.js in api route file",
      filename: apiRouteFile,
      code: `import { validate } from "../lib/validate.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/lib/validate.js" },
        },
      ],
      output: `import { validate } from "@api/lib/validate.js";`,
    },
    {
      name: "EDGE-001: import type with ../ in api route file",
      filename: apiRouteFile,
      code: `import type { Foo } from "../lib/types.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/lib/types.js" },
        },
      ],
      output: `import type { Foo } from "@api/lib/types.js";`,
    },
    {
      name: "REQ-003, EDGE-002: export * from ../db/schema.js in api route file",
      filename: apiRouteFile,
      code: `export * from "../db/schema.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/db/schema.js" },
        },
      ],
      output: `export * from "@api/db/schema.js";`,
    },
    {
      name: "EDGE-003: ../../../deeply/nested.js from deep sub-dir",
      filename: "/repo/packages/api/src/a/b/c/file.ts",
      code: `import foo from "../../../deeply/nested.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/deeply/nested.js" },
        },
      ],
      output: `import foo from "@api/deeply/nested.js";`,
    },
    {
      name: "EDGE-004: ../lib/validate.js in api repositories subdirectory",
      filename: apiRepoFile,
      code: `import { validate } from "../lib/validate.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/lib/validate.js" },
        },
      ],
      output: `import { validate } from "@api/lib/validate.js";`,
    },
    {
      name: "EDGE-005: ../lib/validate.js in api test file",
      filename: apiTestFile,
      code: `import { validate } from "../lib/validate.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@api/lib/validate.js" },
        },
      ],
      output: `import { validate } from "@api/lib/validate.js";`,
    },
    {
      name: "REQ-002: ../lib/validate.js in pipeline file",
      filename: pipelineFile,
      code: `import { validate } from "../lib/validate.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@pipeline/lib/validate.js" },
        },
      ],
      output: `import { validate } from "@pipeline/lib/validate.js";`,
    },
    {
      name: "cross-package: ../../../shared/src/db in api repo file → @newsletter/shared/db",
      filename: apiRepoFile,
      code: `import { rawItems } from "../../../shared/src/db";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@newsletter/shared/db" },
        },
      ],
      output: `import { rawItems } from "@newsletter/shared/db";`,
    },
    {
      name: "cross-package: ../../../shared/src/types/index.js in api file → @newsletter/shared/types/index.js",
      filename: apiRouteFile,
      code: `import type { Foo } from "../../../shared/src/types/index.js";`,
      errors: [
        {
          messageId: "useAlias",
          data: { alias: "@newsletter/shared/types/index.js" },
        },
      ],
      output: `import type { Foo } from "@newsletter/shared/types/index.js";`,
    },
  ],
});
