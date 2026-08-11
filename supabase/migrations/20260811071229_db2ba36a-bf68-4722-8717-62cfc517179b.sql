ALTER TABLE public.conversation_turns
  ADD COLUMN IF NOT EXISTS inbound_classification text,
  ADD COLUMN IF NOT EXISTS classification_confidence numeric,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS gate_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extracted_facts jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.inbound_gate_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id text UNIQUE,
  contact_id uuid,
  phone_masked text,
  source_type text NOT NULL DEFAULT 'text',
  classification text NOT NULL,
  secondary_classifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  should_advance boolean NOT NULL DEFAULT false,
  response_priority text,
  answer_valid boolean NOT NULL DEFAULT false,
  validator_reason text,
  extracted_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_messages integer NOT NULL DEFAULT 0,
  current_question_key text,
  classifier_status text NOT NULL DEFAULT 'ok',
  routes jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_gate_decisions_contact_idx
  ON public.inbound_gate_decisions (contact_id, created_at DESC);

GRANT SELECT ON public.inbound_gate_decisions TO authenticated;
GRANT ALL ON public.inbound_gate_decisions TO service_role;
ALTER TABLE public.inbound_gate_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read inbound gate decisions" ON public.inbound_gate_decisions;
CREATE POLICY "admins read inbound gate decisions"
  ON public.inbound_gate_decisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));