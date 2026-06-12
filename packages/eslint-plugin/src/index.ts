import type { TSESLint } from "@typescript-eslint/utils";
import collectorReturnShape from "./rules/collector-return-shape.js";
import enforceRepositoryAccess from "./rules/enforce-repository-access.js";
import enforceTenantScope from "./rules/enforce-tenant-scope.js";

const PLUGIN_NAME = "@newsletter/eslint-plugin";
const PLUGIN_VERSION = "0.0.1";

export type PluginRules = Record<
  string,
  TSESLint.RuleModule<string, readonly unknown[]>
>;

export const rules: PluginRules = {
  "collector-return-shape": collectorReturnShape as TSESLint.RuleModule<
    string,
    readonly unknown[]
  >,
  "enforce-repository-access": enforceRepositoryAccess as TSESLint.RuleModule<
    string,
    readonly unknown[]
  >,
  "enforce-tenant-scope": enforceTenantScope as TSESLint.RuleModule<
    string,
    readonly unknown[]
  >,
};

export const plugin: TSESLint.FlatConfig.Plugin & { rules: PluginRules } = {
  meta: {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
  },
  rules,
};

export default plugin;
