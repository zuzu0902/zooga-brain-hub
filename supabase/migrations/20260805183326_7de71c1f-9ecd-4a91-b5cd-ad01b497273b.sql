ALTER TABLE public.manager_handoffs
  ADD COLUMN IF NOT EXISTS escalation_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS last_http_status integer,
  ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS manager_handoffs_open_idx
  ON public.manager_handoffs (contact_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS manager_handoffs_idempotency_key_idx
  ON public.manager_handoffs (idempotency_key) WHERE idempotency_key IS NOT NULL;