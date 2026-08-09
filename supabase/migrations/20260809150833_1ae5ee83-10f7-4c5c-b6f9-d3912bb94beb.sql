ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opening_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS opening_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS opening_deferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_asked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  stage text,
  button_id text,
  button_title text,
  source_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.onboarding_events TO authenticated;
GRANT ALL ON public.onboarding_events TO service_role;

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read onboarding events"
  ON public.onboarding_events FOR SELECT TO authenticated
  USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_events_dedupe
  ON public.onboarding_events (contact_id, event_type, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS onboarding_events_contact_idx
  ON public.onboarding_events (contact_id, created_at DESC);