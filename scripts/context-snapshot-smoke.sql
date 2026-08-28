-- PRODUCTION-SCHEMA SMOKE for tamar_context_snapshots.
--
-- Proves against the REAL table (service role) that:
--   1. the columns the runtime writes exist,
--   2. a NON-partial unique index on inbound_message_id exists, so the
--      runtime's ON CONFLICT (inbound_message_id) upsert is inferable,
--   3. write -> read -> re-upsert of a snapshot containing the current
--      inbound (raw + normalized) succeeds,
--   4. everything is rolled back: no row survives.
--
-- SAFETY: read/write happens inside a transaction that ends in ROLLBACK.
-- It uses a synthetic contact_id of NULL and a synthetic inbound id
-- ('smoke.<uuid>'), never contact 7833, and it cannot send WhatsApp:
-- this file is pure SQL with no network or messaging path.

BEGIN;

-- 1. columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tamar_context_snapshots'
ORDER BY column_name;

-- 2. unique index must NOT be partial (indpred IS NULL)
SELECT i.relname AS index_name, ix.indisunique, ix.indpred IS NULL AS non_partial
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
WHERE t.relname = 'tamar_context_snapshots' AND ix.indisunique;

-- 3. write -> read -> conflicting re-upsert
INSERT INTO public.tamar_context_snapshots
  (contact_id, inbound_message_id, context_version, source_counts, source_ids, context, token_estimate)
VALUES
  (NULL, 'smoke.' || gen_random_uuid()::text, 'v2.ctx.3',
   '{"inbound":1,"transcript":0}'::jsonb, '{}'::jsonb,
   '{"inbound":{"raw_text":"smoke raw","normalized_text":"smoke normalized"}}'::jsonb, 10)
RETURNING id, inbound_message_id, context -> 'inbound';

-- conflict path (same inbound id) must update, not error
WITH last AS (
  SELECT inbound_message_id FROM public.tamar_context_snapshots
  WHERE inbound_message_id LIKE 'smoke.%' ORDER BY created_at DESC LIMIT 1
)
INSERT INTO public.tamar_context_snapshots
  (contact_id, inbound_message_id, context_version, source_counts, source_ids, context, token_estimate)
SELECT NULL, inbound_message_id, 'v2.ctx.3', '{}'::jsonb, '{}'::jsonb, '{"inbound":{"raw_text":"second"}}'::jsonb, 11
FROM last
ON CONFLICT (inbound_message_id) DO UPDATE SET context = EXCLUDED.context
RETURNING id, context -> 'inbound' ->> 'raw_text';

-- 4. nothing persists
ROLLBACK;
