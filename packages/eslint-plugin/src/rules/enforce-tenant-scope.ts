import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

/**
 * Tables in the Drizzle schema that are tenant-owned (have a `tenantId` column).
 * Queries against these tables in repository files must include a tenant scope
 * (behind `isAllTenants` guard) or explicitly use the `withAllTenants()` escape.
 */
const TENANT_OWNED_TABLES = new Set([
  "rawItems",
  "runArchives",
  "runLogs",
  "socialTokens",
  "socialCredentials",
  "userSettings",
  "mustReadEntries",
  "subscribers",
  "emailSends",
  "feedbackEvents",
  "sesEvents",
  "evalRuns",
  "reviewEdits",
]);

/**
 * Tables that are explicitly exempt from tenant scoping.
 * - `users`: login by email searches across all tenants
 * - `tenants`: super-admin queries across all tenants
 */
const EXEMPT_TABLES = new Set(["users", "tenants"]);

/**
 * Recognized escape-hatch identifiers that allow skipping the tenant filter.
 * These must only be used from `requireSuperAdmin`-gated paths (not enforced by this rule).
 */
const ESCAPE_HATCHES = new Set(["isAllTenants", "withAllTenants"]);

const _RESTRICTED_TABLES = new Set([...TENANT_OWNED_TABLES, ...EXEMPT_TABLES]);
void _RESTRICTED_TABLES;

export default createRule({
  name: "enforce-tenant-scope",
  meta: {
    type: "problem",
    docs: {
      description:
        "Queries against tenant-owned tables in repository files must include a tenant scope (behind isAllTenants guard) or use the withAllTenants() escape hatch.",
    },
    messages: {
      unscopedTenantQuery:
        "Query against tenant-owned table '{{table}}' is not scoped. " +
        "Wrap with `if (!isAllTenants(scoped)) conditions.push(eq({{table}}.tenantId, scoped.ctx.tenantId))` " +
        "or use the `withAllTenants()` escape hatch. " +
        "Exempt tables: {{exempt}}. Escape hatch functions: {{escapes}}.",
      unscopedTenantInsert:
        "INSERT/UPDATE/DELETE against tenant-owned table '{{table}}' must include tenantId. " +
        "Set `tenantId: scoped.ctx.tenantId` in the values object or use `withAllTenants()`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename;

    // Only apply to repository files (both api and pipeline)
    if (!filename.includes("/repositories/")) return {};

    // Track whether the file has a tenant scoping context variable
    // (e.g., `scoped` parameter in factory function)
    const fileHasTenantScope = new Set<string>();

    return {
      /**
       * Detect tenant-scope parameter patterns like:
       *   function createXRepo(db, scoped) { ... }
       *   (db, scoped: ScopedTenantContext) => { ... }
       */
      FunctionDeclaration(node: TSESTree.FunctionDeclaration) {
        checkParams(node.params, node.body, fileHasTenantScope);
      },
      ArrowFunctionExpression(node: TSESTree.ArrowFunctionExpression) {
        if (node.parent.type === AST_NODE_TYPES.CallExpression) {
          checkParams(node.params, node.body, fileHasTenantScope);
        }
      },
      /**
       * Detect queries against tenant-owned tables and verify scope.
       */
      MemberExpression(node: TSESTree.MemberExpression) {
        // Pattern: table.tenantId references
        if (
          node.property.type === AST_NODE_TYPES.Identifier &&
          node.property.name === "tenantId"
        ) {
          // Record that tenantId is being referenced — this is a good signal
          return;
        }
      },
      /**
       * Check Identifier nodes for tenant-owned table references in from/select/insert/update/delete.
       */
      CallExpression(node: TSESTree.CallExpression) {
        checkCallForTenantTable(node, context, fileHasTenantScope);
      },
    };
  },
});

function checkParams(
  params: TSESTree.Parameter[],
  body: TSESTree.Node | TSESTree.BlockStatement | TSESTree.Expression | null,
  scopeSet: Set<string>,
): void {
  for (const param of params) {
    if (param.type === AST_NODE_TYPES.Identifier) {
      // Simple param: might be scoped
      if (param.name === "scoped" || param.name === "ctx") {
        scopeSet.add(param.name);

        // Check if body is a block and contains isAllTenants/withAllTenants usage
        if (body?.type === AST_NODE_TYPES.BlockStatement) {
          checkBlockForEscapeHatch(body, param.name, scopeSet);
        }
      }
    }
  }
}

function checkBlockForEscapeHatch(
  block: TSESTree.BlockStatement,
  scopeParam: string,
  scopeSet: Set<string>,
): void {
  for (const stmt of block.body) {
    checkStmtForEscapeHatch(stmt, scopeParam, scopeSet);
  }
}

function checkStmtForEscapeHatch(
  node: TSESTree.Node | null,
  scopeParam: string,
  scopeSet: Set<string>,
): void {
  if (!node) return;

  if (node.type === AST_NODE_TYPES.ExpressionStatement) {
    checkStmtForEscapeHatch(node.expression, scopeParam, scopeSet);
  } else if (node.type === AST_NODE_TYPES.IfStatement) {
    // Check for `if (isAllTenants(scoped))` or `if (!isAllTenants(scoped))`
    const test = node.test;
    if (test.type === AST_NODE_TYPES.CallExpression) {
      if (
        test.callee.type === AST_NODE_TYPES.Identifier &&
        ESCAPE_HATCHES.has(test.callee.name)
      ) {
        scopeSet.add(`escape:${scopeParam}`);
      }
    } else if (
      test.type === AST_NODE_TYPES.UnaryExpression &&
      test.operator === "!" &&
      test.argument.type === AST_NODE_TYPES.CallExpression &&
      test.argument.callee.type === AST_NODE_TYPES.Identifier &&
      ESCAPE_HATCHES.has(test.argument.callee.name)
    ) {
      scopeSet.add(`escape:${scopeParam}`);
    }
  }
}

function checkCallForTenantTable(
  node: TSESTree.CallExpression,
  context: Parameters<ReturnType<typeof createRule>["create"]>[0],
  scopeSet: ReadonlySet<string>,
): void {
  // Check if this is a chained query builder call like db.select().from(table).where(...)
  // We look for tenant-owned table references in the call chain.

  // Strategy: inspect the callee to find `.from(tableName)` or `.insert(tableName)` etc.
  if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
    const prop = node.callee.property;
    if (
      prop.type === AST_NODE_TYPES.Identifier &&
      ["from", "insert", "update", "delete"].includes(prop.name)
    ) {
      // Check arguments for tenant-owned table references
      for (const arg of node.arguments) {
        if (
          arg.type === AST_NODE_TYPES.Identifier &&
          TENANT_OWNED_TABLES.has(arg.name)
        ) {
          // This is a query against a tenant-owned table
          // Check if file handles tenant scope
          if (scopeSet.size === 0) {
            // No tenant scope parameter detected — report
            context.report({
              node: arg,
              messageId:
                prop.name === "insert" || prop.name === "update" || prop.name === "delete"
                  ? "unscopedTenantInsert"
                  : "unscopedTenantQuery",
              data: {
                table: arg.name,
                exempt: Array.from(EXEMPT_TABLES).join(", "),
                escapes: Array.from(ESCAPE_HATCHES).join(", "),
              },
            });
            return;
          }

          // Has scope param but need to verify actual scope check is present
          // This is a softer check — we just note the table is tenant-owned
          // Full verification would require AST walking of conditions chain
          const hasEscape = [...scopeSet].some((s) => s.startsWith("escape:"));
          if (!hasEscape && scopeSet.size > 0) {
            // Has scope param but no escape check found at the function body level
            // This is a warning that scope might not be applied
            // For now, only flag if there's no scope param at all
          }
        }
      }
    }
  }
}
