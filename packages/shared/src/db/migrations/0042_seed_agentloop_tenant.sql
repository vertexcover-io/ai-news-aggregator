-- Seed the AGENTLOOP tenant (tenant 0) so the tenant_id FKs added in 0041 are
-- always satisfiable on any migrated database — a fresh deploy, dev, or test DB
-- can write the back-compat singleton settings/credentials row without first
-- running the separate cutover script. Idempotent.
INSERT INTO "tenants" ("id", "slug", "status", "name", "headline", "canon_enabled", "built_page_enabled")
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'agentloop',
  'active',
  'AGENTLOOP',
  'The daily read for people who ship with agents.',
  true,
  true
)
ON CONFLICT ("id") DO NOTHING;
