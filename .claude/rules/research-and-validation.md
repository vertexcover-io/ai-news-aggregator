# Research & Validation

## Always research before coding

Before writing any code that uses an external library, API, or framework feature:
1. Use context7 MCP to fetch current documentation for the library/framework
2. Use web search to verify API signatures, configuration options, and best practices
3. Never assume syntax, method signatures, or default behavior from memory — docs change between versions

This applies to every dependency in the stack: Hono, Drizzle, BullMQ, Vite, Resend, and any future additions.

## Validate approaches before proposing

Before proposing a solution or architectural approach:
1. Verify it fits the project scope by checking the spec docs in `docs/superpowers/specs/`
2. Cross-reference with web search results to confirm the approach is current and accurate
3. If the approach involves a library or tool not already in the stack, research alternatives and justify the addition
4. Never propose a solution based solely on general knowledge — back it with current documentation
