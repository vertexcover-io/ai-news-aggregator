---
paths:
  - "packages/api/**/*.ts"
---

# API Layer Rules

## Route design

- All routes must be typed end-to-end: request params, request body, and response shape
- Use Hono's built-in validation and type inference for request parsing
- Keep route handlers thin — extract business logic into service functions under `src/services/`
- Group related routes in their own file under `src/routes/`
