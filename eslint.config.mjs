import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import newsletter from "@newsletter/eslint-plugin";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/*.config.*",
      "**/scripts/",
      "**/tests/e2e/*.mjs",
      ".worktrees/",
    ],
  },
  {
    plugins: {
      newsletter,
    },
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["**/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  // Layer 1: pipeline must not depend on HTTP frameworks or @newsletter/api
  {
    files: ["packages/pipeline/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["hono", "hono/*"],
              message: "Pipeline package must not import HTTP frameworks.",
            },
            {
              group: ["express", "fastify"],
              message: "Pipeline package must not import HTTP frameworks.",
            },
          ],
          paths: [
            {
              name: "@newsletter/api",
              message: "Pipeline cannot depend on @newsletter/api.",
            },
          ],
        },
      ],
    },
  },
  // Layer 1: web must not import the DB layer directly
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message: "Web package must not import drizzle-orm.",
            },
            {
              name: "@newsletter/shared/db",
              message: "Web package must not import the DB layer.",
            },
          ],
          patterns: [
            {
              group: ["@newsletter/shared/db/*"],
              message: "Web package must not import the DB layer.",
            },
          ],
        },
      ],
    },
  },
  // Layer 1: API route handlers must delegate DB access to services/repositories
  {
    files: ["packages/api/src/routes/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message:
                "Route handlers must delegate DB access to services/repositories.",
            },
            {
              name: "@newsletter/shared/db",
              message:
                "Route handlers must delegate DB access to services/repositories.",
            },
          ],
        },
      ],
    },
  },
  // newsletter/collector-return-shape: type-aware rule that pins every
  // exported function in pipeline collectors to Promise<CollectorResult>.
  {
    files: ["packages/pipeline/src/collectors/**/*.ts"],
    plugins: { newsletter },
    rules: {
      "newsletter/collector-return-shape": "error",
    },
  },
  // newsletter/enforce-repository-access: value imports of
  // @newsletter/shared/db and drizzle-orm are only allowed inside repository
  // modules. Scoped to api + pipeline service source, excluding repositories
  // themselves and all test files.
  {
    files: ["packages/api/src/**/*.ts", "packages/pipeline/src/**/*.ts"],
    ignores: [
      "packages/api/src/repositories/**",
      "packages/pipeline/src/repositories/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "packages/*/tests/**",
    ],
    plugins: { newsletter },
    rules: { "newsletter/enforce-repository-access": "error" },
  },
  // newsletter/enforce-tenant-scope: tenant-owned tables must be queried through
  // a tenant scope (ctx param + scoped where + raw SQL mentioning tenant_id).
  // Scoped to repository modules; error from Phase 2 on (post backfill/isolation gate).
  {
    files: [
      "packages/api/src/repositories/**/*.ts",
      "packages/pipeline/src/repositories/**/*.ts",
    ],
    ignores: ["**/*.test.ts"],
    plugins: { newsletter },
    rules: {
      "newsletter/enforce-tenant-scope": [
        "error",
        {
          tenantOwnedTables: [
            "raw_items",
            "run_archives",
            "run_logs",
            "review_edits",
            "email_sends",
            "subscribers",
            "feedback_events",
            "ses_events",
            "eval_runs",
            "must_read_entries",
            "user_settings",
            "social_credentials",
            "social_tokens",
            "sources",
            "sending_domains",
            "onboarding_progress",
          ],
          appLevelTables: [
            "tenants",
            "users",
            "impersonation_audit",
            "password_reset_tokens",
          ],
        },
      ],
    },
  },
);
