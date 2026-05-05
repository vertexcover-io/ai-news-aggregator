// Set required env vars before any test file that imports pipeline entry points
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret";
