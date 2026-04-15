// Set required env vars before any test file that imports pipeline entry points
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-key";
process.env.VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "test-voyage-key";
