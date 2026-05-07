
-- Enums
DO $$ BEGIN
  CREATE TYPE public.imported_lead_status AS ENUM ('imported','duplicate','ready_for_intake','sent_to_tamar','replied','converted_to_contact','failed','opted_out');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_consent_status AS ENUM ('unknown','approved','declined');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.whatsapp_template_status AS ENUM ('not_sent','sent','delivered','read','replied','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- imported_leads
CREATE TABLE IF NOT EXISTS public.imported_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  first_name text,
  last_name text,
  phone text,
  source_file_name text,
  source_campaign text,
  import_status public.imported_lead_status NOT NULL DEFAULT 'imported',
  consent_status public.lead_consent_status NOT NULL DEFAULT 'unknown',
  whatsapp_template_status public.whatsapp_template_status NOT NULL DEFAULT 'not_sent',
  contact_id uuid,
  raw_row_data jsonb,
  notes text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imported_leads_phone ON public.imported_leads(phone);
CREATE INDEX IF NOT EXISTS idx_imported_leads_status ON public.imported_leads(import_status);

DROP TRIGGER IF EXISTS imported_leads_touch ON public.imported_leads;
CREATE TRIGGER imported_leads_touch BEFORE UPDATE ON public.imported_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.imported_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read imported_leads" ON public.imported_leads FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public write imported_leads" ON public.imported_leads FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- intake_campaigns
CREATE TABLE IF NOT EXISTS public.intake_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name text NOT NULL,
  template_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_count integer NOT NULL DEFAULT 0,
  tamar_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intake_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read intake_campaigns" ON public.intake_campaigns FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public write intake_campaigns" ON public.intake_campaigns FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- api_settings extra fields
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS tamar_backend_url text;
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS tamar_backend_api_token text;
