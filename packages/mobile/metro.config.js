// Metro config tuned for this pnpm + Turborepo monorepo.
// Lets Metro find the package's own node_modules AND the hoisted workspace root,
// and watches the whole repo so shared changes are picked up.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the package first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. pnpm uses symlinks/isolated node_modules — disable the hierarchical
//    lookup that assumes a flat, hoisted tree so resolution stays deterministic.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
