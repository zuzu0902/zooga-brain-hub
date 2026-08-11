ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_evidence text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_whatsapp_opt_in_status_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_whatsapp_opt_in_status_check
      CHECK (whatsapp_opt_in_status IN ('unknown','verified','denied'));
  END IF;
END $$;

UPDATE public.contacts
SET whatsapp_opt_in_status = 'denied',
    whatsapp_opt_in_at = COALESCE(whatsapp_opt_in_at, opted_out_at),
    whatsapp_opt_in_source = COALESCE(whatsapp_opt_in_source, 'legacy_opt_out')
WHERE opted_out_at IS NOT NULL
  AND whatsapp_opt_in_status = 'unknown';

UPDATE public.contacts
SET whatsapp_opt_in_status = 'verified',
    whatsapp_opt_in_at = COALESCE(whatsapp_opt_in_at, updated_at, created_at, now()),
    whatsapp_opt_in_source = COALESCE(whatsapp_opt_in_source, 'legacy_consent')
WHERE consent_marketing IS TRUE
  AND opted_out_at IS NULL
  AND whatsapp_opt_in_status = 'unknown';

CREATE INDEX IF NOT EXISTS contacts_whatsapp_opt_in_status_idx
  ON public.contacts (whatsapp_opt_in_status);