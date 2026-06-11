import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

const isRestrictedSource = (source: string): boolean =>
  source === "@newsletter/shared/db" ||
  source.startsWith("@newsletter/shared/db/") ||
  source === "drizzle-orm" ||
  source.startsWith("drizzle-orm/");

/** Tenant-owned tables that require a tenantId filter in queries.
 *  `users` is NOT in this set — login-by-email lookups are exempt.
 *  `tenants` is NOT in this set — it's the tenant definition table. */
const TENANT_OWNED_TABLES = new Set([
  "rawItems",
  "runArchives",
  "runLogs",
  "socialCredentials",
  "socialTokens",
  "userSettings",
  "mustReadEntries",
  "subscribers",
  "emailSends",
  "feedbackEvents",
  "sesEvents",
  "evalRuns",
  "reviewEdits",
]);

export default createRule({
  name: "enforce-repository-access",
  meta: {
    type: "problem",
    docs: {
      description:
        "Value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside repository modules. Type-only imports are allowed everywhere. Additionally, in repository files, queries against tenant-owned tables must include a tenantId filter.",
    },
    messages: {
      repositoryOnly:
        "Value imports from '{{source}}' are only allowed inside repository modules. Move this query into {{expected}} and inject the repo instead. (Type-only `import type { ... }` is still allowed.)",
      unscopedTenantQuery:
        "Query against tenant-owned table '{{table}}' must include a tenantId filter (e.g. eq({{table}}.tenantId, ctx.tenantId)). Use withAllTenants() for cross-tenant super-admin reads, or add the tenant predicate.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename;
    const isRepoFile =
      filename.includes("/repositories/") &&
      !filename.includes("/tests/") &&
      !/\.test\.tsx?$/.test(filename);

    // Track tenant-owned tables imported in this file (for tenant-scoping check)
    const importedTenantTables = new Set<string>();
    // Track whether a tenant table's .tenantId was referenced in a where clause
    const tablesWithTenantIdAccessed = new Set<string>();
    // Track whether withAllTenants() was called
    let hasWithAllTenants = false;

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

        // Track tenant-owned table imports for tenant-scoping check
        if (isRepoFile && (source === "@newsletter/shared/db" || source.startsWith("@newsletter/shared/db/"))) {
          for (const spec of node.specifiers) {
            if (
              spec.type === AST_NODE_TYPES.ImportSpecifier &&
              spec.importKind !== "type"
            ) {
              if (TENANT_OWNED_TABLES.has(spec.local.name)) {
                importedTenantTables.add(spec.local.name);
              }
            }
          }
        }

        const fileIsExempt =
          filename.includes("/repositories/") ||
          filename.includes("/tests/") ||
          /\.test\.tsx?$/.test(filename);
        if (fileIsExempt) return;

        const expected = filename.includes("/packages/api/")
          ? "packages/api/src/repositories/"
          : "packages/pipeline/src/repositories/";

        context.report({
          node,
          messageId: "repositoryOnly",
          data: { source, expected },
        });
      },

      // Phase 4: Check that queries against tenant-owned tables include tenantId filter
      MemberExpression(node: TSESTree.MemberExpression): void {
        if (!isRepoFile) return;

        // Check for table.tenantId access
        if (
          node.property.type === AST_NODE_TYPES.Identifier &&
          node.property.name === "tenantId" &&
          node.object.type === AST_NODE_TYPES.Identifier &&
          TENANT_OWNED_TABLES.has(node.object.name)
        ) {
          tablesWithTenantIdAccessed.add(node.object.name);
        }
      },

      CallExpression(node: TSESTree.CallExpression): void {
        if (!isRepoFile) return;

        // Check for withAllTenants() escape hatch (standalone or method call)
        if (
          (node.callee.type === AST_NODE_TYPES.Identifier &&
            node.callee.name === "withAllTenants") ||
          (node.callee.type === AST_NODE_TYPES.MemberExpression &&
            node.callee.property.type === AST_NODE_TYPES.Identifier &&
            node.callee.property.name === "withAllTenants")
        ) {
          hasWithAllTenants = true;
        }

        // Check for eq(table.tenantId, ...) pattern within where clauses
        // This handles the common Drizzle where() -> eq() pattern
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === "eq" &&
          node.arguments.length >= 2
        ) {
          for (const arg of node.arguments) {
            if (
              arg.type === AST_NODE_TYPES.MemberExpression &&
              arg.property.type === AST_NODE_TYPES.Identifier &&
              arg.property.name === "tenantId" &&
              arg.object.type === AST_NODE_TYPES.Identifier &&
              TENANT_OWNED_TABLES.has(arg.object.name)
            ) {
              tablesWithTenantIdAccessed.add(arg.object.name);
            }
          }
        }
      },

      "Program:exit"(): void {
        if (!isRepoFile) return;
        if (importedTenantTables.size === 0) return;
        if (hasWithAllTenants) return;

        // Check each imported tenant-owned table
        for (const tableName of importedTenantTables) {
          if (!tablesWithTenantIdAccessed.has(tableName)) {
            context.report({
              loc: { line: 1, column: 0 },
              messageId: "unscopedTenantQuery",
              data: { table: tableName },
            });
          }
        }
      },
    };
  },
});
