# Bundle assets as TypeScript constants, not runtime file reads

When a Node package is built with tsup (or any bundler), `readFileSync` calls that resolve paths via `import.meta.url` or `__dirname` break at runtime — the bundler rewrites the source layout, so the asset file is no longer where the resolved path points. The code works in dev (tsx) and fails in the built artifact.

For any non-code asset that needs to ship with a bundled Node package (prompts, templates, SQL strings, fixtures), convert it to a `.ts` file that exports the content as a `const` string. The bundler then inlines it into the output and there's no filesystem lookup at runtime.

```ts
// BAD: breaks after tsup bundling
const prompt = readFileSync(
  fileURLToPath(new URL("./prompt.md", import.meta.url)),
  "utf8",
);

// GOOD: inlined by the bundler
import { SUMMARIZER_PROMPT } from "./prompts/summarizer.js";
```

Why: Recurring bug pattern (hit again in the run-ui run as the C1 issue). `import.meta.url` resolves relative to the bundled output file, not the original source, so the asset path no longer points at anything. Inlining via TS constants is the only reliable fix in a tsup/esbuild context.

Enforced by: newsletter/no-bundled-readfilesync
