import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from "@typescript-eslint/utils";
import type * as ts from "typescript";
import { createRule } from "../utils/create-rule.js";

const COLLECTOR_RESULT_NAME = "CollectorResult";
const PROMISE_NAME = "Promise";
const COLLECTOR_NAME_PREFIX = "collect";

// A "collector function" is an exported function whose identifier begins with
// `collect` (e.g. `collectHn`, `collectReddit`, `collectWeb`). Other exports
// in collector files are helpers and not subject to this rule.
const isCollectorFunctionName = (name: string): boolean =>
  name.startsWith(COLLECTOR_NAME_PREFIX) &&
  name.length > COLLECTOR_NAME_PREFIX.length;

const isCollectorResultType = (type: ts.Type): boolean => {
  if (type.aliasSymbol?.name === COLLECTOR_RESULT_NAME) return true;
  // `type.symbol` is typed as non-optional but is undefined for many type
  // shapes (intrinsics, anonymous object types). Use the indexed access form
  // so the optional check survives `no-unnecessary-condition`.
  const symbolName = (type as { symbol?: ts.Symbol }).symbol?.name;
  if (symbolName === COLLECTOR_RESULT_NAME) return true;
  // `getBaseTypes` exists only on InterfaceType; guard via the indexed form.
  // It can return undefined for non-interface types even when present.
  const getBaseTypes = (
    type as { getBaseTypes?: () => ts.BaseType[] | undefined }
  ).getBaseTypes;
  if (typeof getBaseTypes === "function") {
    const baseTypes = getBaseTypes.call(type);
    if (baseTypes) {
      for (const base of baseTypes) {
        if (isCollectorResultType(base)) return true;
      }
    }
  }
  return false;
};

export default createRule({
  name: "collector-return-shape",
  meta: {
    type: "problem",
    docs: {
      description:
        "Collector functions must return Promise<CollectorResult>.",
    },
    messages: {
      wrongReturnType:
        "Collector `{{name}}` must return `Promise<CollectorResult>`, found `{{actual}}`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    if (context.filename.endsWith(".d.ts")) return {};

    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    const checkFunction = (
      fnNode:
        | TSESTree.FunctionDeclaration
        | TSESTree.ArrowFunctionExpression,
      name: string,
    ): void => {
      const type = services.getTypeAtLocation(fnNode);
      const signatures = type.getCallSignatures();
      if (signatures.length === 0) return;
      const signature = signatures[0];
      const returnType = checker.getReturnTypeOfSignature(signature);

      const reportWrong = (): void => {
        context.report({
          node: fnNode,
          messageId: "wrongReturnType",
          data: { name, actual: checker.typeToString(returnType) },
        });
      };

      const returnSymbolName = (returnType as { symbol?: ts.Symbol }).symbol
        ?.name;
      if (returnSymbolName !== PROMISE_NAME) {
        reportWrong();
        return;
      }

      const typeArgs = checker.getTypeArguments(
        returnType as ts.TypeReference,
      );
      if (typeArgs.length === 0) {
        reportWrong();
        return;
      }

      const inner = typeArgs[0];
      if (!isCollectorResultType(inner)) {
        reportWrong();
      }
    };

    return {
      "ExportNamedDeclaration > FunctionDeclaration"(
        node: TSESTree.FunctionDeclaration,
      ): void {
        if (node.id && isCollectorFunctionName(node.id.name)) {
          checkFunction(node, node.id.name);
        }
      },
      "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator"(
        node: TSESTree.VariableDeclarator,
      ): void {
        if (
          node.init?.type === AST_NODE_TYPES.ArrowFunctionExpression &&
          node.id.type === AST_NODE_TYPES.Identifier &&
          isCollectorFunctionName(node.id.name)
        ) {
          checkFunction(node.init, node.id.name);
        }
      },
    };
  },
});
