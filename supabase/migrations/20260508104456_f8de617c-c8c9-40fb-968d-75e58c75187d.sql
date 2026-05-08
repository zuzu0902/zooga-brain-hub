ALTER TYPE contact_source ADD VALUE IF NOT EXISTS 'Tamar WhatsApp';

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS preferred_language_style text,
  ADD COLUMN IF NOT EXISTS intake_status text;