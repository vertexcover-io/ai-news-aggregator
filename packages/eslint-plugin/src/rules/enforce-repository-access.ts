import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

const isRestrictedSource = (source: string): boolean =>
  source === "@newsletter/shared/db" ||
  source.startsWith("@newsletter/shared/db/") ||
  source === "drizzle-orm" ||
  source.startsWith("drizzle-orm/");

export default createRule({
  name: "enforce-repository-access",
  meta: {
    type: "problem",
    docs: {
      description:
        "Value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside repository modules. Type-only imports are allowed everywhere.",
    },
    messages: {
      repositoryOnly:
        "Value imports from '{{source}}' are only allowed inside repository modules. Move this query into {{expected}} and inject the repo instead. (Type-only `import type { ... }` is still allowed.)",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        const source = node.source.value;
        if (!isRestrictedSource(source)) return;

        if (node.importKind === "type") return;

        const allSpecifiersAreTypeOnly =
          node.specifiers.length > 0 &&
          node.specifiers.every(
            (s) =>
              s.type === AST_NODE_TYPES.ImportSpecifier &&
              s.importKind === "type",
          );
        if (allSpecifiersAreTypeOnly) return;

        const filename = context.filename;
        if (
          filename.includes("/repositories/") ||
          filename.includes("/tests/") ||
          /\.test\.tsx?$/.test(filename)
        ) {
          return;
        }

        const expected = filename.includes("/packages/api/")
          ? "packages/api/src/repositories/"
          : "packages/pipeline/src/repositories/";

        context.report({
          node,
          messageId: "repositoryOnly",
          data: { source, expected },
        });
      },
    };
  },
});
