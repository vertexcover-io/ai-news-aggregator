# Process

## Linear references

When working on a tracked issue, reference the Linear issue ID (VER-XX) in commit messages and PR descriptions. Use the format: `feat(VER-30): set up monorepo structure`.

## Testing and verification

- Write tests for business logic (processing stages, ranking, dedup, API services)
- Don't claim work is done until `pnpm build` and `pnpm typecheck` pass with zero errors
- If adding a new package or dependency, verify it doesn't break the build across all packages
- Run the relevant tests before marking a task complete
