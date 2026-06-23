-- P14 fix (REQ-053 regression / EDGE-005): grandfather AGENTLOOP (tenant 0)
-- to a verified sending domain. 0046 added tenants.sending_domain_status as
-- NULLABLE with NO default, leaving AGENTLOOP NULL — which the (fail-closed)
-- broadcast gate treats as "not verified", blocking its real subscriber
-- broadcasts. AGENTLOOP historically broadcasts via the shared platform
-- sender, so it is the one tenant allowed through without registering a
-- domain. Idempotent and tenant-0-only (slug guard + IS NULL guard): fresh
-- tenants stay NULL -> blocked until they verify (deliberately NOT a column
-- default, which would wrongly grandfather brand-new tenants).
UPDATE "tenants"
SET "sending_domain_status" = 'verified'
WHERE "slug" = 'agentloop' AND "sending_domain_status" IS NULL;
