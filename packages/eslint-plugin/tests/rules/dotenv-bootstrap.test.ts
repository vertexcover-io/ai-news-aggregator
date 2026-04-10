import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/dotenv-bootstrap.js";

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

ruleTester.run("dotenv-bootstrap", rule, {
  valid: [
    {
      name: "valid bootstrap followed by other imports",
      code: [
        `import { config } from "dotenv";`,
        `config({ path: "../../.env" });`,
        `import { Hono } from "hono";`,
        `const app = new Hono();`,
      ].join("\n"),
    },
    {
      name: "valid bootstrap as only content",
      code: [
        `import { config } from "dotenv";`,
        `config({ path: "../../.env" });`,
      ].join("\n"),
    },
  ],
  invalid: [
    {
      name: "first statement is a different import",
      code: [
        `import { Hono } from "hono";`,
        `import { config } from "dotenv";`,
        `config({ path: "../../.env" });`,
      ].join("\n"),
      errors: [{ messageId: "missingBootstrap" }],
    },
    {
      name: "dotenv import present but second statement is not config call",
      code: [
        `import { config } from "dotenv";`,
        `const x = 1;`,
      ].join("\n"),
      errors: [{ messageId: "missingBootstrap" }],
    },
    {
      name: "config called with wrong path",
      code: [
        `import { config } from "dotenv";`,
        `config({ path: "./.env" });`,
      ].join("\n"),
      errors: [{ messageId: "wrongPath" }],
    },
    {
      name: "EDGE-001: CommonJS require as first statement",
      code: [
        `const { config } = require("dotenv");`,
        `config({ path: "../../.env" });`,
      ].join("\n"),
      errors: [{ messageId: "missingBootstrap" }],
    },
    {
      name: "config called with no arguments",
      code: [
        `import { config } from "dotenv";`,
        `config();`,
      ].join("\n"),
      errors: [{ messageId: "wrongPath" }],
    },
    {
      name: "empty file",
      code: ``,
      errors: [{ messageId: "missingBootstrap" }],
    },
    {
      name: "dotenv import without `config` named specifier",
      code: [
        `import dotenv from "dotenv";`,
        `dotenv.config({ path: "../../.env" });`,
      ].join("\n"),
      errors: [{ messageId: "missingBootstrap" }],
    },
  ],
});
