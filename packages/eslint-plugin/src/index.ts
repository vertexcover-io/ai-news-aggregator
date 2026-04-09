import type { TSESLint } from "@typescript-eslint/utils";
import dotenvBootstrap from "./rules/dotenv-bootstrap.js";
import noBundledReadfilesync from "./rules/no-bundled-readfilesync.js";
import noRawAlterTable from "./rules/no-raw-alter-table.js";

const PLUGIN_NAME = "@newsletter/eslint-plugin";
const PLUGIN_VERSION = "0.0.1";

export type PluginRules = Record<
  string,
  TSESLint.RuleModule<string, readonly unknown[]>
>;

export const rules: PluginRules = {
  "dotenv-bootstrap": dotenvBootstrap as TSESLint.RuleModule<
    string,
    readonly unknown[]
  >,
  "no-bundled-readfilesync": noBundledReadfilesync as TSESLint.RuleModule<
    string,
    readonly unknown[]
  >,
  "no-raw-alter-table": noRawAlterTable as TSESLint.RuleModule<
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
