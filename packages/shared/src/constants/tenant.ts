export const TENANT_ZERO_ID = "00000000-0000-0000-0000-000000000000";

// App-level shared credentials (e.g. the Twitter collector cookie, F62/F66)
// live in tenant 0's social_credentials store. Use this alias at call sites
// that intentionally read/write the shared app-level row so the intent is
// explicit and greppable.
export const APP_CREDENTIALS_TENANT_ID = TENANT_ZERO_ID;

export const RESERVED_SLUGS: readonly string[] = [
  "app",
  "www",
  "admin",
  "api",
  "mail",
  "static",
  "assets",
  "cdn",
  "docs",
  "status",
  "help",
  "support",
  "blog",
  "dev",
  "staging",
  "test",
];
