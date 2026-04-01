# Tooling

## Package manager

Always use `pnpm`. Never use `npm` or `yarn` for installing dependencies, running scripts, or any other package management task. This includes scaffolding — when a CLI offers a package manager choice, select pnpm.

## Container runtime

Always use `podman-compose` for infrastructure commands. Never use `docker` or `docker-compose`. The compose file is compatible with both, but all commands and scripts must reference podman.

## Environment variables

- Never hardcode secrets, database URLs, ports, or API keys in source code
- All configuration goes through `.env` files loaded at runtime
- `.env.example` is committed with placeholder values; `.env` is gitignored
- When adding a new env var, update both `.env.example` and `.env`

## Dependencies

- Don't install new packages without first checking if an existing dependency already covers the need
- Prefer lightweight, focused packages over heavy frameworks
- Always install exact versions (no `^` or `~` ranges in package.json)
- When adding a dependency, add it to the correct package — shared deps in `shared`, API-only deps in `api`, etc.
