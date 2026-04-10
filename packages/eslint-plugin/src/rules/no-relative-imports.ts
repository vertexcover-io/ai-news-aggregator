import { dirname, resolve } from "node:path";
import { createRule } from "../utils/create-rule.js";

// Same-package tsconfig path aliases
const SAME_PACKAGE_ALIAS: Record<string, string> = {
  api: "@api",
  pipeline: "@pipeline",
};

// Cross-package workspace package names (when ../  traverses into another package)
const WORKSPACE_PACKAGE: Record<string, string> = {
  shared: "@newsletter/shared",
  web: "@newsletter/web",
  api: "@newsletter/api",
  pipeline: "@newsletter/pipeline",
};

function buildAlias(pkg: string, rest: string, isSamePackage: boolean): string | null {
  if (isSamePackage) {
    const prefix = SAME_PACKAGE_ALIAS[pkg];
    return prefix ? `${prefix}/${rest}` : null;
  }
  const name = WORKSPACE_PACKAGE[pkg];
  if (!name) return null;
  // Cross-package: import resolves into packages/<pkg>/src/<rest>
  // The public import is @newsletter/<pkg>/<rest> (subpath export)
  return `${name}/${rest}`;
}

function computeAlias(filename: string, specifier: string): string | null {
  if (!specifier.startsWith("..")) return null;

  const normalizedFilename = filename.replace(/\\/g, "/");
  const dir = dirname(normalizedFilename);
  const resolved = resolve(dir, specifier).replace(/\\/g, "/");

  const targetMatch = /packages\/([^/]+)\/src\/(.+)$/.exec(resolved);
  if (!targetMatch) return null;
  const [, targetPkg, rest] = targetMatch;

  const sourceMatch = /packages\/([^/]+)\/src\//.exec(normalizedFilename);
  const isSamePackage = sourceMatch?.[1] === targetPkg;

  return buildAlias(targetPkg, rest, isSamePackage);
}

export default createRule({
  name: "no-relative-imports",
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Disallow `../` imports in service packages — use `@api/`/`@pipeline/` for same-package imports or `@newsletter/<pkg>` for cross-package imports.",
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
