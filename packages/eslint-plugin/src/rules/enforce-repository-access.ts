import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

const isRestrictedSource = (source: string): boolean =>
  source === "@newsletter/shared/db" ||
  source.startsWith("@newsletter/shared/db/") ||
  source === "drizzle-orm" ||
  source.startsWith("drizzle-orm/");

/**
 * Drizzle schema identifiers for the 13 tenant-owned tables (P2 enforce
 * migration). Every repository query against one of these MUST carry a
 * tenant predicate (REQ-014). `users` / `tenants` are deliberately absent —
 * the login-by-email lookup and tenant CRUD are platform-level (allowlist).
 */
const TENANT_OWNED_TABLES: ReadonlySet<string> = new Set([
  "rawItems",
  "runArchives",
  "runLogs",
  "reviewEdits",
  "emailSends",
  "subscribers",
  "feedbackEvents",
  "sesEvents",
  "evalRuns",
  "mustReadEntries",
  "userSettings",
  "socialCredentials",
  "socialTokens",
]);

/** Query-builder entry points whose table argument we inspect. */
const QUERY_ENTRY_PROPERTIES: ReadonlySet<string> = new Set([
  "from",
  "insert",
  "update",
  "delete",
]);

/**
 * Recognized tenant-scoping markers. The check is intentionally lexical at
 * enclosing-function granularity: the predicate seam is
 * `tenantScoped(table.tenantId, ctx, …)` / `scopedTenantId(ctx)` from
 * `@newsletter/shared/db`, and `withAllTenants(…)` is the audited super-admin
 * cross-tenant escape hatch. A bare `tenantId` reference also counts so
 * hand-rolled `eq(table.tenantId, …)` predicates pass.
 */
const TENANT_SCOPE_MARKER = /tenantScoped\s*\(|scopedTenantId\s*\(|withAllTenants\s*\(|tenantId/;

const isFunctionNode = (
  node: TSESTree.Node,
): node is
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression =>
  node.type === AST_NODE_TYPES.FunctionDeclaration ||
  node.type === AST_NODE_TYPES.FunctionExpression ||
  node.type === AST_NODE_TYPES.ArrowFunctionExpression;

/** Nearest enclosing function (or Program) — the audit window for the marker. */
const enclosingScopeNode = (node: TSESTree.Node): TSESTree.Node => {
  let current: TSESTree.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isFunctionNode(current) || current.type === AST_NODE_TYPES.Program) {
      return current;
    }
    current = current.parent;
  }
  return node;
};

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
      tenantScopeRequired:
        "Query against tenant-owned table '{{table}}' has no tenant scope. Filter through `tenantScoped({{table}}.tenantId, ctx, ...)` (or stamp inserts with `scopedTenantId(ctx)`); super-admin cross-tenant reads must go through `withAllTenants(...)`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename;
    const isExemptFile =
      filename.includes("/tests/") || /\.test\.tsx?$/.test(filename);
    const isRepositoryFile = filename.includes("/repositories/");

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        // Tenant-scope check (REQ-014): only inside repository modules —
        // everywhere else the import check below already forbids drizzle.
        if (!isRepositoryFile || isExemptFile) return;

        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !QUERY_ENTRY_PROPERTIES.has(callee.property.name)
        ) {
          return;
        }

        if (node.arguments.length === 0) return;
        const tableArg = node.arguments[0];
        if (
          tableArg.type !== AST_NODE_TYPES.Identifier ||
          !TENANT_OWNED_TABLES.has(tableArg.name)
        ) {
          return;
        }

        const scopeText = context.sourceCode.getText(enclosingScopeNode(node));
        if (TENANT_SCOPE_MARKER.test(scopeText)) return;

        context.report({
          node: tableArg,
          messageId: "tenantScopeRequired",
          data: { table: tableArg.name },
        });
      },

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

        if (isRepositoryFile || isExemptFile) return;

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
