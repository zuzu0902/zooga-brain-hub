ALTER TABLE public.tamar_runtime_executions
  ADD COLUMN IF NOT EXISTS conversation_mode text,
  ADD COLUMN IF NOT EXISTS conversation_mode_reasons jsonb;

CREATE INDEX IF NOT EXISTS tamar_runtime_executions_conversation_mode_idx
  ON public.tamar_runtime_executions (conversation_mode);