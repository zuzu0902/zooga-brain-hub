ALTER TABLE public.tamar_model_calls
  ADD COLUMN IF NOT EXISTS complexity TEXT,
  ADD COLUMN IF NOT EXISTS routing_reason TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12,6);

CREATE TABLE public.tamar_writeback_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbound_message_id TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT 'tamar_v2',
  facts_written INTEGER NOT NULL DEFAULT 0,
  memories_written INTEGER NOT NULL DEFAULT 0,
  insights_written INTEGER NOT NULL DEFAULT 0,
  summary_updated BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tamar_writeback_ledger_inbound_uniq
  ON public.tamar_writeback_ledger (inbound_message_id, runtime);
CREATE INDEX tamar_writeback_ledger_contact_idx
  ON public.tamar_writeback_ledger (contact_id, created_at DESC);

GRANT SELECT ON public.tamar_writeback_ledger TO authenticated;
GRANT ALL ON public.tamar_writeback_ledger TO service_role;

ALTER TABLE public.tamar_writeback_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view writeback ledger"
  ON public.tamar_writeback_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages writeback ledger"
  ON public.tamar_writeback_ledger FOR ALL TO service_role
  USING (true) WITH CHECK (true);