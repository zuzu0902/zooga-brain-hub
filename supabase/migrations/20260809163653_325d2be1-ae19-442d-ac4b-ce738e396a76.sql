ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS relationship_intake_status text NOT NULL DEFAULT 'not_offered',
  ADD COLUMN IF NOT EXISTS relationship_intake_offered_at timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_intake_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_intake_deferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS residence_city text,
  ADD COLUMN IF NOT EXISTS looking_for_relationship text,
  ADD COLUMN IF NOT EXISTS likes_travel text,
  ADD COLUMN IF NOT EXISTS travel_scope text,
  ADD COLUMN IF NOT EXISTS last_trip_destination text;

ALTER TABLE public.intake_field_definitions
  ADD COLUMN IF NOT EXISTS depends_on jsonb NOT NULL DEFAULT '{}'::jsonb;