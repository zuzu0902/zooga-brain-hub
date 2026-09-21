-- Database-only audit of the exact final customer-facing outbound text.
ALTER TABLE public.tamar_runtime_executions
  ADD COLUMN IF NOT EXISTS output_text text;

COMMENT ON COLUMN public.tamar_runtime_executions.output_text IS
  'Exact final customer-facing text delivered to WhatsApp for this turn. NULL for intentionally silent turns. Database-only: never forwarded to Gateway, Shadow payloads or logs.';

-- Idempotency key: exactly one runtime execution row per inbound provider message.
ALTER TABLE public.tamar_runtime_executions
  ADD COLUMN IF NOT EXISTS inbound_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS tamar_runtime_executions_inbound_unique
  ON public.tamar_runtime_executions (contact_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
