import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/no-bundled-readfilesync.js";

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

ruleTester.run("no-bundled-readfilesync", rule, {
  valid: [
    {
      name: "literal path argument is fine",
      code: [
        `import { readFileSync } from "node:fs";`,
        `const x = readFileSync("./static-path.txt");`,
      ].join("\n"),
    },
    {
      name: "variable argument is not trackable and is allowed",
      code: [
        `import * as fs from "node:fs";`,
        `function load(p: string) { return fs.readFileSync(p, "utf8"); }`,
      ].join("\n"),
    },
    {
      name: "different function name is unaffected",
      code: [
        `import { readFile } from "node:fs/promises";`,
        `await readFile(new URL("./x", import.meta.url));`,
      ].join("\n"),
    },
  ],
  invalid: [
    {
      name: "REQ-040: readFileSync(new URL(..., import.meta.url))",
      code: [
        `import { readFileSync } from "node:fs";`,
        `const x = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");`,
      ].join("\n"),
      errors: [{ messageId: "bundledUrlRead" }],
    },
    {
      name: "REQ-041: readFileSync(fileURLToPath(new URL(..., import.meta.url)))",
      code: [
        `import { readFileSync } from "node:fs";`,
        `import { fileURLToPath } from "node:url";`,
        `const x = readFileSync(fileURLToPath(new URL("./prompt.md", import.meta.url)), "utf8");`,
      ].join("\n"),
      errors: [{ messageId: "bundledUrlRead" }],
    },
    {
      name: "REQ-042: readFileSync(path.join(__dirname, ...))",
      code: [
        `import { readFileSync } from "node:fs";`,
        `import path from "node:path";`,
        `const x = readFileSync(path.join(__dirname, "file.txt"), "utf8");`,
      ].join("\n"),
      errors: [{ messageId: "bundledDirnameRead" }],
    },
    {
      name: "REQ-043: member-shape fs.readFileSync(new URL(..., import.meta.url))",
      code: [
        `import * as fs from "node:fs";`,
        `const x = fs.readFileSync(new URL("./x", import.meta.url));`,
      ].join("\n"),
      errors: [{ messageId: "bundledUrlRead" }],
    },
    {
      name: "template literal containing __dirname",
      code: [
        `import { readFileSync } from "node:fs";`,
        "const x = readFileSync(`${__dirname}/file.txt`, \"utf8\");",
      ].join("\n"),
      errors: [{ messageId: "bundledDirnameRead" }],
    },
  ],
});
