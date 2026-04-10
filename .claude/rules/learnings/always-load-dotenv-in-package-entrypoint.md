# Always load dotenv at the top of every package entry point

Every runnable package (`api`, `pipeline`, any future service) must load the root `.env` explicitly at the very top of its entry file, before any other imports that might read `process.env`. Use the same two-line bootstrap across packages:

```ts
import { config } from "dotenv";
config({ path: "../../.env" });

// ...rest of imports
```

Do NOT rely on Turborepo, pnpm, or the shell to propagate env vars to child processes — each package is its own Node process and `pnpm dev` at the root does not inject dotenv into spawned children. A package that "works" without this bootstrap is only working because the missing env var happens to not be read yet.

Why: In the run-ui slice, the pipeline package loaded `../../.env` explicitly but the API package didn't. Everything looked fine while runs were in progress (only Redis was touched), but the moment a run reached `completed` status and `GET /api/runs/:runId` called `getDb()` via `hydrateRankedItems`, the API crashed with `DATABASE_URL environment variable is not set`. The bug had been latent since the API package was scaffolded and only surfaced when a lazily-initialized code path first ran. Loading dotenv at the entry point is the cheap, uniform fix and prevents this class of "works until it doesn't" failure.

Enforced by: newsletter/dotenv-bootstrap
