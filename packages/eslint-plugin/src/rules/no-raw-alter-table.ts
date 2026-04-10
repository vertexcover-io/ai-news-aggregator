import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

const ALTER_TABLE = /ALTER\s+TABLE/i;

export default createRule({
  name: "no-raw-alter-table",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw `ALTER TABLE` statements via `.execute()` — use a Drizzle Kit migration instead.",
    },
    messages: {
      rawAlterTable:
        "Raw `ALTER TABLE` via `.execute()` is forbidden. Use a Drizzle Kit migration instead. See `.claude/rules/database.md`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (
          node.callee.property.type !== AST_NODE_TYPES.Identifier ||
          node.callee.property.name !== "execute"
        ) {
          return;
        }

        if (node.arguments.length === 0) return;
        const arg0 = node.arguments[0];
        if (arg0.type === AST_NODE_TYPES.SpreadElement) return;

        if (
          arg0.type === AST_NODE_TYPES.Literal &&
          typeof arg0.value === "string" &&
          ALTER_TABLE.test(arg0.value)
        ) {
          context.report({ node: arg0, messageId: "rawAlterTable" });
          return;
        }

        if (arg0.type === AST_NODE_TYPES.TemplateLiteral) {
          const rawText = arg0.quasis.map((q) => q.value.raw).join("");
          if (ALTER_TABLE.test(rawText)) {
            context.report({ node: arg0, messageId: "rawAlterTable" });
          }
        }
      },
    };
  },
});
