CREATE TABLE IF NOT EXISTS public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid,
  inbound_message_id text,
  route text not null default 'unknown',
  normalized_intent text,
  asked_field text,
  question_signature text,
  response_signature text,
  action text,
  state_before text,
  state_after text,
  facts_before jsonb not null default '{}'::jsonb,
  facts_after jsonb not null default '{}'::jsonb,
  progress_made boolean not null default false,
  repeat_count integer not null default 0,
  loop_signal boolean not null default false,
  guard_verdict text,
  guard_reason text,
  recovery_action text,
  phone_masked text,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

GRANT SELECT ON public.conversation_turns TO authenticated;
GRANT ALL ON public.conversation_turns TO service_role;
ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read conversation_turns" ON public.conversation_turns FOR SELECT TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS conversation_turns_contact_idx ON public.conversation_turns (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_created_idx ON public.conversation_turns (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_inbound_route_uidx ON public.conversation_turns (inbound_message_id, route) WHERE inbound_message_id IS NOT NULL;

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS intake_deferred_fields text[] NOT NULL DEFAULT '{}'::text[];