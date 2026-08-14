// Self-contained ESLint config for the Expo app. The repo-root flat config
// (strict type-checked, Node-oriented) intentionally ignores packages/mobile/ —
// React Native + JSX needs its own toolchain. Run via `pnpm --filter
// @newsletter/mobile lint`.
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "node_modules/*"],
  },
];
