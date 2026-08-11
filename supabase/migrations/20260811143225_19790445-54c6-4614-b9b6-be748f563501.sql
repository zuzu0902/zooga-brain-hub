ALTER TABLE public.runtime_inbound_dedupe
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'claimed',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS no_reply_reason text;

UPDATE public.runtime_inbound_dedupe
   SET state = 'completed', completed_at = coalesce(completed_at, last_seen_at, created_at)
 WHERE state = 'claimed' AND coalesce(btrim(reply_text), '') <> '';

CREATE INDEX IF NOT EXISTS runtime_inbound_dedupe_state_idx
  ON public.runtime_inbound_dedupe (state, last_seen_at);