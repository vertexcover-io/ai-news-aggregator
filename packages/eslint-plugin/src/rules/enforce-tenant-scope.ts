import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

type Options = [{ tenantOwnedTables?: string[]; appLevelTables?: string[] }];

const isSchemaSource = (source: string): boolean =>
  source === "@newsletter/shared/db" ||
  source.startsWith("@newsletter/shared/db/") ||
  source === "@newsletter/shared" ||
  source.startsWith("@newsletter/shared/");

const camelToSnake = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

const getCalleeProperty = (node: TSESTree.CallExpression): string | null => {
  const callee = node.callee;
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
};

const collectChainCallees = (
  node: TSESTree.Expression,
  out: string[],
): void => {
  if (node.type !== AST_NODE_TYPES.CallExpression) return;
  const prop = getCalleeProperty(node);
  if (prop) out.push(prop);
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.MemberExpression) {
    collectChainCallees(callee.object, out);
  }
};

export default createRule<Options, string>({
  name: "enforce-tenant-scope",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Repository queries against tenant-owned tables must be tenant-scoped (ctx param, .where(...), or tenant_id in raw SQL).",
    },
    messages: {
      missingCtxParam:
        "Repository factory '{{factory}}' queries tenant-owned table '{{table}}' but does not declare a ctx/TenantContext parameter. Thread a `ctx?: TenantContext` through and use tenantScope().",
      unscopedQuery:
        "Query against tenant-owned table '{{table}}' has no .where(...) in its chain. Apply scope.where(...) so it is tenant-scoped.",
      rawSqlMissingTenant:
        "Raw sql against tenant-owned table '{{table}}' does not reference tenant_id. Add a tenant_id predicate.",
    },
    schema: [
      {
        type: "object",
        properties: {
          tenantOwnedTables: { type: "array", items: { type: "string" } },
          appLevelTables: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ tenantOwnedTables: [], appLevelTables: [] }],
  create(context, [options]) {
    if (!context.filename.includes("/repositories/")) return {};

    const tenantOwned = new Set(options.tenantOwnedTables ?? []);
    if (tenantOwned.size === 0) return {};

    const identifierToTable = new Map<string, string>();

    const resolveTable = (identifier: string): string | null => {
      const direct = identifierToTable.get(identifier);
      if (direct && tenantOwned.has(direct)) return direct;
      const snake = camelToSnake(identifier);
      if (tenantOwned.has(snake)) return snake;
      return null;
    };

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        if (!isSchemaSource(node.source.value)) return;
        for (const spec of node.specifiers) {
          if (spec.type !== AST_NODE_TYPES.ImportSpecifier) continue;
          if (spec.importKind === "type") continue;
          const local = spec.local.name;
          identifierToTable.set(local, camelToSnake(local));
        }
      },

      "FunctionDeclaration, FunctionExpression, ArrowFunctionExpression"(
        node:
          | TSESTree.FunctionDeclaration
          | TSESTree.FunctionExpression
          | TSESTree.ArrowFunctionExpression,
      ): void {
        const factory = factoryName(node);
        if (!factory || !/^create[A-Z].*Repo/.test(factory)) return;

        const declaresCtx = node.params.some((p) => paramMentionsCtx(p));
        if (declaresCtx) return;

        const sourceText = context.sourceCode.getText(node.body);
        for (const [identifier, table] of identifierToTable) {
          if (!tenantOwned.has(table)) continue;
          if (
            new RegExp(`\\b${identifier}\\b`).test(sourceText) ||
            sourceText.includes(table)
          ) {
            context.report({
              node,
              messageId: "missingCtxParam",
              data: { factory, table },
            });
            return;
          }
        }
      },

      CallExpression(node: TSESTree.CallExpression): void {
        if (getCalleeProperty(node) !== "from") return;
        const arg = node.arguments[0] as TSESTree.Node | undefined;
        if (arg?.type !== AST_NODE_TYPES.Identifier) return;
        const table = resolveTable(arg.name);
        if (!table) return;

        const root = chainRoot(node);
        const callees: string[] = [];
        collectChainCallees(root, callees);
        if (callees.includes("where")) return;

        context.report({
          node,
          messageId: "unscopedQuery",
          data: { table },
        });
      },

      TaggedTemplateExpression(
        node: TSESTree.TaggedTemplateExpression,
      ): void {
        if (
          node.tag.type !== AST_NODE_TYPES.Identifier ||
          node.tag.name !== "sql"
        ) {
          return;
        }
        const text = node.quasi.quasis
          .map((q) => q.value.cooked ?? q.value.raw)
          .join(" ");
        const match =
          /(?:from|update|into)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/i.exec(text);
        if (!match) return;
        const table = match[1].toLowerCase();
        if (!tenantOwned.has(table)) return;
        if (/tenant_id/i.test(text)) return;

        context.report({
          node,
          messageId: "rawSqlMissingTenant",
          data: { table },
        });
      },
    };
  },
});

const factoryName = (
  node:
    | TSESTree.FunctionDeclaration
    | TSESTree.FunctionExpression
    | TSESTree.ArrowFunctionExpression,
): string | null => {
  if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id) {
    return node.id.name;
  }
  const parent = node.parent;
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  return null;
};

const paramMentionsCtx = (param: TSESTree.Parameter): boolean => {
  const target =
    param.type === AST_NODE_TYPES.AssignmentPattern ? param.left : param;
  if (target.type === AST_NODE_TYPES.Identifier) {
    if (/ctx/i.test(target.name)) return true;
    const annotation = target.typeAnnotation?.typeAnnotation;
    if (
      annotation?.type === AST_NODE_TYPES.TSTypeReference &&
      annotation.typeName.type === AST_NODE_TYPES.Identifier
    ) {
      return annotation.typeName.name.includes("TenantContext");
    }
  }
  return false;
};

const chainRoot = (
  node: TSESTree.CallExpression,
): TSESTree.Expression => {
  let current: TSESTree.Node = node;
  while (
    (current.parent.type === AST_NODE_TYPES.MemberExpression &&
      current.parent.object === current) ||
    (current.parent.type === AST_NODE_TYPES.CallExpression &&
      current.parent.callee === current)
  ) {
    current = current.parent;
  }
  return current as TSESTree.Expression;
};
