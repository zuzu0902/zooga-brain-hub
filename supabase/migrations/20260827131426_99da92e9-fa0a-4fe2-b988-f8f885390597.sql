CREATE TABLE public.tamar_context_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbound_message_id TEXT,
  context_version TEXT NOT NULL DEFAULT 'v2.ctx.1',
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_trace_id UUID,
  token_estimate INTEGER,
  retain_until DATE NOT NULL DEFAULT (now() + interval '90 days')::date,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tamar_context_snapshots_inbound_uniq
  ON public.tamar_context_snapshots (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
CREATE INDEX tamar_context_snapshots_contact_idx
  ON public.tamar_context_snapshots (contact_id, created_at DESC);
CREATE INDEX tamar_context_snapshots_retain_idx
  ON public.tamar_context_snapshots (retain_until);

GRANT SELECT ON public.tamar_context_snapshots TO authenticated;
GRANT ALL ON public.tamar_context_snapshots TO service_role;

ALTER TABLE public.tamar_context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view context snapshots"
  ON public.tamar_context_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages context snapshots"
  ON public.tamar_context_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);