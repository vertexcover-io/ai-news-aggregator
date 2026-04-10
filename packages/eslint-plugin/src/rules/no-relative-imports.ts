import { dirname, resolve } from "node:path";
import { createRule } from "../utils/create-rule.js";

const ALIAS_MAP: Record<string, string> = {
  api: "@api",
  pipeline: "@pipeline",
};

function computeAlias(filename: string, specifier: string): string | null {
  if (!specifier.startsWith("..")) return null;

  const dir = dirname(filename);
  const resolved = resolve(dir, specifier).replace(/\\/g, "/");
  const match = /packages\/([^/]+)\/src\/(.+)$/.exec(resolved);
  if (!match) return null;

  const [, pkg, rest] = match;
  const prefix = ALIAS_MAP[pkg];
  if (!prefix) return null;

  return `${prefix}/${rest}`;
}

export default createRule({
  name: "no-relative-imports",
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Disallow `../` imports in api and pipeline packages — use `@api/` or `@pipeline/` path aliases instead.",
    },
    messages: {
      useAlias: "Use '{{alias}}' instead of a relative `../` import.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function check(
      source: import("@typescript-eslint/utils").TSESTree.StringLiteral,
    ): void {
      const specifier = source.value;
      const alias = computeAlias(context.filename, specifier);
      if (alias === null) return;

      context.report({
        node: source,
        messageId: "useAlias",
        data: { alias },
        fix(fixer) {
          return fixer.replaceText(source, `"${alias}"`);
        },
      });
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) {
          check(node.source);
        }
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
    };
  },
});
