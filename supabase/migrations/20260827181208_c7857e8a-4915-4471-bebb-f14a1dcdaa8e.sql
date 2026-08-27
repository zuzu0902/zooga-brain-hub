-- 1) FIX: the snapshot upsert could never work.
-- The uniqueness was a PARTIAL index (WHERE inbound_message_id IS NOT NULL),
-- which Postgres cannot infer from `ON CONFLICT (inbound_message_id)`.
-- Every single production snapshot write failed with SQLSTATE 42P10 and the
-- error was swallowed by a best-effort catch => zero rows.
DROP INDEX IF EXISTS public.tamar_context_snapshots_inbound_uniq;
CREATE UNIQUE INDEX tamar_context_snapshots_inbound_uniq
  ON public.tamar_context_snapshots (inbound_message_id);

-- 2) Snapshot <-> runtime execution linkage
ALTER TABLE public.tamar_context_snapshots
  ADD COLUMN IF NOT EXISTS runtime_execution_id uuid,
  ADD COLUMN IF NOT EXISTS active_topic text,
  ADD COLUMN IF NOT EXISTS active_offer_id uuid;

-- 3) Writeback rows must point at the exact context they were derived from
ALTER TABLE public.tamar_writeback_ledger
  ADD COLUMN IF NOT EXISTS context_snapshot_id uuid;

-- 4) Voice: keep the raw transcript immutable, add an audited normalized form
ALTER TABLE public.voice_transcripts
  ADD COLUMN IF NOT EXISTS transcript_normalized text,
  ADD COLUMN IF NOT EXISTS normalization_reason text,
  ADD COLUMN IF NOT EXISTS normalization_confidence numeric;

-- 5) Operational errors of the mandatory context transaction must be visible.
CREATE TABLE IF NOT EXISTS public.tamar_context_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbound_message_id text,
  stage text NOT NULL,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_context_failures TO authenticated;
GRANT ALL ON public.tamar_context_failures TO service_role;
ALTER TABLE public.tamar_context_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view context failures"
  ON public.tamar_context_failures FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role manages context failures"
  ON public.tamar_context_failures TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS tamar_context_failures_created_idx
  ON public.tamar_context_failures (created_at DESC);