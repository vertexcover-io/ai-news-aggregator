import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../utils/create-rule.js";

const hasImportMetaUrl = (n: TSESTree.Node): boolean => {
  if (
    n.type === AST_NODE_TYPES.MetaProperty &&
    n.meta.name === "import" &&
    n.property.name === "meta"
  ) {
    return true;
  }
  if (
    n.type === AST_NODE_TYPES.NewExpression &&
    n.callee.type === AST_NODE_TYPES.Identifier &&
    n.callee.name === "URL"
  ) {
    return n.arguments.some(
      (a) => a.type !== AST_NODE_TYPES.SpreadElement && hasImportMetaUrl(a),
    );
  }
  if (n.type === AST_NODE_TYPES.MemberExpression) {
    return hasImportMetaUrl(n.object);
  }
  if (
    n.type === AST_NODE_TYPES.CallExpression &&
    n.callee.type === AST_NODE_TYPES.Identifier &&
    n.callee.name === "fileURLToPath"
  ) {
    return n.arguments.some(
      (a) => a.type !== AST_NODE_TYPES.SpreadElement && hasImportMetaUrl(a),
    );
  }
  return false;
};

const hasDirname = (n: TSESTree.Node): boolean => {
  if (n.type === AST_NODE_TYPES.Identifier && n.name === "__dirname") return true;
  if (n.type === AST_NODE_TYPES.BinaryExpression) {
    return (
      (n.left.type !== AST_NODE_TYPES.PrivateIdentifier &&
        hasDirname(n.left)) ||
      hasDirname(n.right)
    );
  }
  if (n.type === AST_NODE_TYPES.TemplateLiteral) {
    return n.expressions.some(hasDirname);
  }
  if (n.type === AST_NODE_TYPES.CallExpression) {
    return n.arguments.some(
      (a) => a.type !== AST_NODE_TYPES.SpreadElement && hasDirname(a),
    );
  }
  return false;
};

export default createRule({
  name: "no-bundled-readfilesync",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `readFileSync` calls that resolve paths via `import.meta.url` or `__dirname` — these break after tsup bundling.",
    },
    messages: {
      bundledUrlRead:
        "readFileSync with `new URL(..., import.meta.url)` breaks after tsup bundling. Inline the asset as a TypeScript const string instead. See `.claude/rules/learnings/bundled-assets-need-import-not-readfilesync.md`.",
      bundledDirnameRead:
        "readFileSync resolving via `__dirname` breaks after tsup bundling. Inline the asset as a TypeScript const string instead.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const isReadFileSync =
          (node.callee.type === AST_NODE_TYPES.Identifier &&
            node.callee.name === "readFileSync") ||
          (node.callee.type === AST_NODE_TYPES.MemberExpression &&
            node.callee.property.type === AST_NODE_TYPES.Identifier &&
            node.callee.property.name === "readFileSync");
        if (!isReadFileSync) return;

        if (node.arguments.length === 0) return;
        const arg0 = node.arguments[0];
        if (arg0.type === AST_NODE_TYPES.SpreadElement) return;

        if (hasImportMetaUrl(arg0)) {
          context.report({ node: arg0, messageId: "bundledUrlRead" });
          return;
        }

        if (hasDirname(arg0)) {
          context.report({ node: arg0, messageId: "bundledDirnameRead" });
        }
      },
    };
  },
});
