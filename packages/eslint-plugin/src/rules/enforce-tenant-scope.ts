import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

export const DEFAULT_TENANT_TABLES = [
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
  "candidates",
  "evalExports",
  "sources",
  "sendingDomains",
];

const QUERY_METHODS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "execute",
  "findMany",
  "findFirst",
]);

const TENANT_SCOPE_PATTERN = /\btenantId\b|\btenant_id\b/;

const toSnakeCase = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

const isFunctionNode = (node: TSESTree.Node): node is FunctionNode =>
  node.type === AST_NODE_TYPES.FunctionDeclaration ||
  node.type === AST_NODE_TYPES.FunctionExpression ||
  node.type === AST_NODE_TYPES.ArrowFunctionExpression;

const functionName = (fn: FunctionNode): string | null => {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration) {
    return fn.id?.name ?? null;
  }
  const parent = fn.parent;
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  if (
    (parent.type === AST_NODE_TYPES.Property ||
      parent.type === AST_NODE_TYPES.MethodDefinition) &&
    parent.key.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.key.name;
  }
  return null;
};

const isChainParent = (parent: TSESTree.Node, child: TSESTree.Node): boolean =>
  (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === child) ||
  (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === child) ||
  parent.type === AST_NODE_TYPES.AwaitExpression ||
  parent.type === AST_NODE_TYPES.ChainExpression ||
  parent.type === AST_NODE_TYPES.TSNonNullExpression ||
  parent.type === AST_NODE_TYPES.TSAsExpression;

const outermostChain = (node: TSESTree.CallExpression): TSESTree.Node => {
  let current: TSESTree.Node = node;
  while (current.parent && isChainParent(current.parent, current)) {
    current = current.parent;
  }
  return current;
};

const enclosingStatement = (node: TSESTree.Node): TSESTree.Node => {
  let current: TSESTree.Node = node;
  while (
    current.parent &&
    current.parent.type !== AST_NODE_TYPES.BlockStatement &&
    current.parent.type !== AST_NODE_TYPES.Program
  ) {
    current = current.parent;
  }
  return current;
};

interface EnclosingFunctions {
  names: string[];
  scanScope: TSESTree.Node;
}

const resolveEnclosingFunctions = (node: TSESTree.Node): EnclosingFunctions => {
  const names: string[] = [];
  let scanScope: TSESTree.Node | null = null;
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (isFunctionNode(current)) {
      const name = functionName(current);
      if (name !== null) {
        names.push(name);
        scanScope ??= current;
      }
    }
    current = current.parent;
  }
  return { names, scanScope: scanScope ?? enclosingStatement(node) };
};

export interface EnforceTenantScopeOptions {
  tables?: string[];
  allowInFunctions?: string[];
}

interface AllowEntry {
  fileSuffix: string | null;
  name: string;
}

const parseAllowEntry = (entry: string): AllowEntry => {
  const hash = entry.indexOf("#");
  if (hash === -1) return { fileSuffix: null, name: entry };
  return { fileSuffix: entry.slice(0, hash), name: entry.slice(hash + 1) };
};

const matchesFile = (filename: string, fileSuffix: string): boolean =>
  filename === fileSuffix || filename.endsWith(`/${fileSuffix}`);

type Options = [EnforceTenantScopeOptions];

export default createRule<Options, "unscopedQuery">({
  name: "enforce-tenant-scope",
  meta: {
    type: "problem",
    docs: {
      description:
        "Repository queries touching tenant-owned tables must reference tenantId: compose eq(table.tenantId, tenantId) into where clauses and spread tenantId into insert values.",
    },
    messages: {
      unscopedQuery:
        "Query touches tenant-owned table '{{table}}' without referencing tenantId in the enclosing repository method. Compose eq({{table}}.tenantId, tenantId) into the where clause (or spread tenantId into insert values). Documented global tenancy-resolution lookups belong in a factory listed in the rule's allowInFunctions option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          tables: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          allowInFunctions: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (!context.filename.includes("/repositories/")) return {};

    const tables = options.tables ?? DEFAULT_TENANT_TABLES;
    if (tables.length === 0) return {};

    const allowEntries = (options.allowInFunctions ?? []).map(parseAllowEntry);
    const isAllowed = (names: string[]): boolean =>
      allowEntries.some(
        (entry) =>
          names.includes(entry.name) &&
          (entry.fileSuffix === null ||
            matchesFile(context.filename, entry.fileSuffix)),
      );
    const alternatives = [
      ...new Set(tables.flatMap((t) => [t, toSnakeCase(t)])),
    ].join("|");
    const tablePattern = new RegExp(`\\b(${alternatives})\\b`);
    const reportedChains = new Set<TSESTree.Node>();

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (callee.computed) return;
        if (callee.property.type !== AST_NODE_TYPES.Identifier) return;
        if (!QUERY_METHODS.has(callee.property.name)) return;

        const chain = outermostChain(node);
        if (reportedChains.has(chain)) return;

        const tableMatch = tablePattern.exec(context.sourceCode.getText(chain));
        if (!tableMatch) return;

        const { names, scanScope } = resolveEnclosingFunctions(node);
        if (isAllowed(names)) return;

        // Token scan (never raw text) so comments cannot satisfy the check —
        // a `// tenant_id handled upstream` comment must not disarm the rule.
        const hasTenantToken = context.sourceCode
          .getTokens(scanScope)
          .some((token) => TENANT_SCOPE_PATTERN.test(token.value));
        if (hasTenantToken) return;

        reportedChains.add(chain);
        context.report({
          node,
          messageId: "unscopedQuery",
          data: { table: tableMatch[1] },
        });
      },
    };
  },
});
