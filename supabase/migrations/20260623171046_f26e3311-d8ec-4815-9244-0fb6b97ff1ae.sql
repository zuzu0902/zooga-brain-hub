CREATE TABLE IF NOT EXISTS public.runtime_inbound_dedupe (
  inbound_message_id text PRIMARY KEY,
  contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone text NULL,
  reply_text text NULL,
  source text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS runtime_inbound_dedupe_contact_idx
  ON public.runtime_inbound_dedupe (contact_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.runtime_inbound_dedupe TO authenticated;
GRANT ALL ON public.runtime_inbound_dedupe TO service_role;

ALTER TABLE public.runtime_inbound_dedupe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read dedupe ledger"
  ON public.runtime_inbound_dedupe
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));