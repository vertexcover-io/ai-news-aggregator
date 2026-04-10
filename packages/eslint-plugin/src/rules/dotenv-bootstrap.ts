import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

export default createRule({
  name: "dotenv-bootstrap",
  meta: {
    type: "problem",
    docs: {
      description:
        "Package entrypoints must load the root .env before any other code runs.",
    },
    messages: {
      missingBootstrap:
        'Package entrypoint must start with `import { config } from "dotenv"; config({ path: "../../.env" });` before any other imports.',
      wrongPath:
        '`config(...)` must be called with `{ path: "../../.env" }` as the only option.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(node: TSESTree.Program): void {
        if (node.body.length < 2) {
          context.report({ node, messageId: "missingBootstrap" });
          return;
        }
        const first = node.body[0];
        const second = node.body[1];

        if (
          first.type !== AST_NODE_TYPES.ImportDeclaration ||
          first.source.value !== "dotenv" ||
          !first.specifiers.some(
            (s) =>
              s.type === AST_NODE_TYPES.ImportSpecifier &&
              s.imported.type === AST_NODE_TYPES.Identifier &&
              s.imported.name === "config",
          )
        ) {
          context.report({ node, messageId: "missingBootstrap" });
          return;
        }

        if (
          second.type !== AST_NODE_TYPES.ExpressionStatement ||
          second.expression.type !== AST_NODE_TYPES.CallExpression ||
          second.expression.callee.type !== AST_NODE_TYPES.Identifier ||
          second.expression.callee.name !== "config"
        ) {
          context.report({ node, messageId: "missingBootstrap" });
          return;
        }

        if (second.expression.arguments.length === 0) {
          context.report({ node, messageId: "wrongPath" });
          return;
        }
        const arg = second.expression.arguments[0];
        const hasCorrectPath =
          arg.type === AST_NODE_TYPES.ObjectExpression &&
          arg.properties.some(
            (p: TSESTree.ObjectLiteralElement) =>
              p.type === AST_NODE_TYPES.Property &&
              p.key.type === AST_NODE_TYPES.Identifier &&
              p.key.name === "path" &&
              p.value.type === AST_NODE_TYPES.Literal &&
              p.value.value === "../../.env",
          );
        if (!hasCorrectPath) {
          context.report({ node, messageId: "wrongPath" });
        }
      },
    };
  },
});
