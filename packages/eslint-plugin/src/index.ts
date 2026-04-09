import type { TSESLint } from "@typescript-eslint/utils";

const PLUGIN_NAME = "@newsletter/eslint-plugin";
const PLUGIN_VERSION = "0.0.1";

export type PluginRules = Record<
  string,
  TSESLint.RuleModule<string, readonly unknown[]>
>;

export const rules: PluginRules = {};

export const plugin: TSESLint.FlatConfig.Plugin & { rules: PluginRules } = {
  meta: {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
  },
  rules,
};

export default plugin;
