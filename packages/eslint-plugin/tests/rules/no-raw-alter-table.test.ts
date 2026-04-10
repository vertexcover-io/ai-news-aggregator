import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/no-raw-alter-table.js";

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

ruleTester.run("no-raw-alter-table", rule, {
  valid: [
    {
      name: "execute with non-ALTER-TABLE string is fine",
      code: "db.execute(`SELECT 1`);",
    },
    {
      name: "EDGE-010: variable argument is not inspected",
      code: [
        `const query = "ALTER TABLE foo ADD COLUMN bar";`,
        `db.execute(query);`,
      ].join("\n"),
    },
    {
      name: "different method is unaffected",
      code: `db.insert("ALTER TABLE foo ADD COLUMN bar");`,
    },
    {
      name: "execute with no arguments is ignored",
      code: `db.execute();`,
    },
  ],
  invalid: [
    {
      name: "REQ-070: string literal ALTER TABLE",
      code: `db.execute("ALTER TABLE foo ADD COLUMN bar");`,
      errors: [{ messageId: "rawAlterTable" }],
    },
    {
      name: "REQ-071: template literal with ALTER TABLE",
      code: "db.execute(`ALTER TABLE ${table} RENAME TO baz`);",
      errors: [{ messageId: "rawAlterTable" }],
    },
    {
      name: "case insensitive: lowercase alter table",
      code: `db.execute("alter   table foo add column bar");`,
      errors: [{ messageId: "rawAlterTable" }],
    },
    {
      name: "any object with .execute() method is flagged",
      code: `someConn.execute("ALTER TABLE foo DROP COLUMN bar");`,
      errors: [{ messageId: "rawAlterTable" }],
    },
  ],
});
