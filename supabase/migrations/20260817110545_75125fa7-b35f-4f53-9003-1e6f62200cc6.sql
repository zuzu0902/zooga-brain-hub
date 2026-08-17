-- TAMAR LITE — STAGE 1 (shadow only, additive)
CREATE TABLE public.tamar_lite_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  event_kind text NOT NULL DEFAULT 'message',
  contact_id uuid,
  phone_masked text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta_timestamp timestamptz,
  processing_state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_lite_events TO authenticated;
GRANT ALL ON public.tamar_lite_events TO service_role;
ALTER TABLE public.tamar_lite_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lite events admin read" ON public.tamar_lite_events FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX idx_tamar_lite_events_state ON public.tamar_lite_events (processing_state, meta_timestamp);
CREATE INDEX idx_tamar_lite_events_contact ON public.tamar_lite_events (contact_id, meta_timestamp);
CREATE TRIGGER tamar_lite_events_touch BEFORE UPDATE ON public.tamar_lite_events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_lite_conversations (
  contact_id uuid PRIMARY KEY,
  phase text NOT NULL DEFAULT 'awaiting_consent'
    CHECK (phase IN ('awaiting_consent','intake','sales_ready','sales_conversation','human_owned','opted_out','closed')),
  current_question_key text,
  version integer NOT NULL DEFAULT 0,
  last_inbound_wamid text,
  last_outbound_key text,
  human_owned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_lite_conversations TO authenticated;
GRANT ALL ON public.tamar_lite_conversations TO service_role;
ALTER TABLE public.tamar_lite_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lite conversations admin read" ON public.tamar_lite_conversations FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER tamar_lite_conversations_touch BEFORE UPDATE ON public.tamar_lite_conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_lite_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.tamar_lite_events(id) ON DELETE CASCADE,
  contact_id uuid,
  state_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  action jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer_ids uuid[] NOT NULL DEFAULT '{}',
  reason_codes text[] NOT NULL DEFAULT '{}',
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  shadow boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_lite_decisions TO authenticated;
GRANT ALL ON public.tamar_lite_decisions TO service_role;
ALTER TABLE public.tamar_lite_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lite decisions admin read" ON public.tamar_lite_decisions FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX idx_tamar_lite_decisions_contact ON public.tamar_lite_decisions (contact_id, created_at DESC);

CREATE TABLE public.tamar_lite_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  contact_id uuid,
  event_id uuid REFERENCES public.tamar_lite_events(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'shadow',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_lite_outbox TO authenticated;
GRANT ALL ON public.tamar_lite_outbox TO service_role;
ALTER TABLE public.tamar_lite_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lite outbox admin read" ON public.tamar_lite_outbox FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX idx_tamar_lite_outbox_status ON public.tamar_lite_outbox (status, next_attempt_at);
CREATE TRIGGER tamar_lite_outbox_touch BEFORE UPDATE ON public.tamar_lite_outbox FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_lite_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','live')),
  kill_switch boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_lite_settings TO authenticated;
GRANT ALL ON public.tamar_lite_settings TO service_role;
ALTER TABLE public.tamar_lite_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lite settings admin read" ON public.tamar_lite_settings FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER tamar_lite_settings_touch BEFORE UPDATE ON public.tamar_lite_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.tamar_lite_settings (id, mode, kill_switch, notes)
VALUES (true, 'shadow', true, 'Tamar Lite stage 1 — shadow only, no send path')
ON CONFLICT (id) DO NOTHING;