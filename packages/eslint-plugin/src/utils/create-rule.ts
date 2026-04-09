import { ESLintUtils } from "@typescript-eslint/utils";

export const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/vertexcover-io/newsletter/blob/main/packages/eslint-plugin/docs/rules/${name}.md`,
);
