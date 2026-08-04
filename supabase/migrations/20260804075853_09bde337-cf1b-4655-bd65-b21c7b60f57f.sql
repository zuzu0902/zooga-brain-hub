-- ============ A. OFFER VALIDITY ============
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS needs_date_review boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.offers_validate_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.event_date IS NOT NULL AND new.event_end_date IS NOT NULL
     AND new.event_end_date < new.event_date THEN
    RAISE EXCEPTION 'event_end_date must be greater than or equal to event_date';
  END IF;
  new.needs_date_review := (new.event_date IS NULL OR new.event_end_date IS NULL);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS offers_validate_dates_trg ON public.offers;
CREATE TRIGGER offers_validate_dates_trg
  BEFORE INSERT OR UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.offers_validate_dates();

-- backfill: never guess dates, only flag
UPDATE public.offers
   SET needs_date_review = true
 WHERE event_date IS NULL OR event_end_date IS NULL;

-- single authoritative sellable definition
CREATE OR REPLACE VIEW public.offers_sellable
WITH (security_invoker = on) AS
SELECT *
  FROM public.offers
 WHERE status = 'active'
   AND event_date IS NOT NULL
   AND event_end_date IS NOT NULL
   AND event_end_date >= now();

GRANT SELECT ON public.offers_sellable TO authenticated;
GRANT SELECT ON public.offers_sellable TO service_role;

-- public (anon) surface must also be sellable-only
CREATE OR REPLACE VIEW public.offers_public
WITH (security_invoker = on) AS
SELECT id, title, description, category, status, price, currency,
       event_date, event_end_date, offer_url, nights, flights_included,
       created_at, updated_at
  FROM public.offers
 WHERE status = 'active'
   AND event_date IS NOT NULL
   AND event_end_date IS NOT NULL
   AND event_end_date >= now();

-- ============ B. LEAD PIPELINE ============
-- normalize any legacy phones before the unique index
UPDATE public.imported_leads
   SET phone = '+' || regexp_replace(phone, '\D', '', 'g')
 WHERE phone IS NOT NULL AND phone NOT LIKE '+%';

-- collapse duplicates (keep oldest) so the unique index can be created
DELETE FROM public.imported_leads a
 USING public.imported_leads b
 WHERE a.phone IS NOT NULL
   AND a.phone = b.phone
   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS imported_leads_phone_uniq
  ON public.imported_leads (phone) WHERE phone IS NOT NULL;

ALTER TABLE public.imported_leads
  ADD COLUMN IF NOT EXISTS consent_source text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_campaign_id uuid,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS idx_imported_leads_provider_msg
  ON public.imported_leads (provider_message_id);

-- contacts opt-out audit
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_source text;

-- intake campaign control surface
ALTER TABLE public.intake_campaigns
  ADD COLUMN IF NOT EXISTS control_state text NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS batch_size integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'he',
  ADD COLUMN IF NOT EXISTS offer_id uuid,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS intake_campaigns_touch ON public.intake_campaigns;
CREATE TRIGGER intake_campaigns_touch
  BEFORE UPDATE ON public.intake_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- campaign membership rows for intake campaigns
ALTER TABLE public.campaign_contacts
  ALTER COLUMN campaign_id DROP NOT NULL;

ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS intake_campaign_id uuid REFERENCES public.intake_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS imported_lead_id uuid REFERENCES public.imported_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_id uuid,
  ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_contacts_idem_uniq
  ON public.campaign_contacts (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_contacts_intake_contact_uniq
  ON public.campaign_contacts (intake_campaign_id, contact_id) WHERE intake_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_provider_msg
  ON public.campaign_contacts (provider_message_id);