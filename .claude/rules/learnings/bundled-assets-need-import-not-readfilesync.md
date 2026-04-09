# Bundle assets as TypeScript constants, not runtime file reads

When a Node package is built with tsup (or any bundler), `readFileSync` calls that resolve paths via `import.meta.url`, `__dirname`, or `process.cwd()` break at runtime — the bundler rewrites the source layout, so the asset file is no longer where the resolved path points, and `cwd` depends on whoever launched the process. The code works in dev (tsx from the package dir) and fails in the built artifact or when launched from a different cwd.

For any non-code asset that needs to ship with a bundled Node package (prompts, templates, SQL strings, fixtures), convert it to a `.ts` file that exports the content as a `const` string. The bundler then inlines it into the output and there is no filesystem lookup at runtime.

```ts
// BAD: breaks after tsup bundling
const prompt = readFileSync(
  fileURLToPath(new URL("./prompt.md", import.meta.url)),
  "utf8",
);

// BAD: breaks when launched from a different cwd (prod, CI, another package)
const profilesDir = join(process.cwd(), "profiles");
const profile = readFileSync(join(profilesDir, `${name}.yaml`), "utf8");

// GOOD: inlined by the bundler
import { SUMMARIZER_PROMPT } from "./prompts/summarizer.js";
```

## Exception: user-editable runtime config (e.g. profile YAMLs)

Some assets are genuinely runtime-editable and cannot be inlined — the user needs to drop a new YAML into a directory without rebuilding. For these, use an **env var with a source-relative fallback**, never `process.cwd()`:

```ts
// GOOD: env var overrides, fallback is resolved relative to the source file
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const profilesDir = process.env.PROFILES_DIR ?? resolve(here, "../../../profiles");
```

The env var (e.g. `PROFILES_DIR`) is the production contract; the source-relative fallback only fires in dev and must be documented in `.env.example`. `process.cwd()` is never acceptable because whoever starts the process (pnpm, a systemd unit, a Docker entrypoint) controls it and it will not match the developers mental model.

Why: Recurring bug pattern. Hit in the run-ui run as the C1 issue with `import.meta.url` + `readFileSync`, and again in the personalized-ranking run when `profiles.ts` reached for `process.cwd()` to resolve the profiles directory — the pipeline worker launched from the monorepo root happened to work, but any other launch cwd would have crashed. Inlining via TS constants is the fix for static assets; env-var + source-relative fallback is the fix for user-editable runtime config directories.
