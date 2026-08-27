CREATE TABLE public.tamar_conversation_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbound_message_id text NOT NULL,
  runtime text NOT NULL DEFAULT 'tamar_v2',
  reason text,
  trigger_text text,
  cleared jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tamar_conversation_resets_key
  ON public.tamar_conversation_resets (inbound_message_id, runtime);
CREATE INDEX tamar_conversation_resets_contact_idx
  ON public.tamar_conversation_resets (contact_id, created_at DESC);

GRANT SELECT ON public.tamar_conversation_resets TO authenticated;
GRANT ALL ON public.tamar_conversation_resets TO service_role;

ALTER TABLE public.tamar_conversation_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view conversation resets"
  ON public.tamar_conversation_resets FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages conversation resets"
  ON public.tamar_conversation_resets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source_message_id text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_message_unique
  ON public.tasks (source_kind, source_message_id)
  WHERE source_message_id IS NOT NULL;