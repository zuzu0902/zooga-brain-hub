
-- Enums
DO $$ BEGIN
  CREATE TYPE public.intake_flow_type AS ENUM ('trip','event','party','dating','workshop','vip','community','sales_inquiry','generic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.campaign_status AS ENUM ('draft','active','paused','completed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.campaign_status NOT NULL DEFAULT 'draft',
  category text,
  objective text,
  description text,
  campaign_type text,
  source_platform text,
  ad_copy text,
  landing_text text,
  images text[] NOT NULL DEFAULT '{}',
  videos text[] NOT NULL DEFAULT '{}',
  whatsapp_number text,
  target_audience text,
  target_age_ranges text[] NOT NULL DEFAULT '{}',
  target_regions text[] NOT NULL DEFAULT '{}',
  target_personality_types text[] NOT NULL DEFAULT '{}',
  emotional_angle text,
  tone_style text,
  offer_id uuid,
  intake_flow_type public.intake_flow_type NOT NULL DEFAULT 'generic',
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  objections text[] NOT NULL DEFAULT '{}',
  prohibited_promises text[] NOT NULL DEFAULT '{}',
  desired_conversion_action text,
  ai_goal text,
  ai_behavior_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_from timestamptz,
  active_until timestamptz,
  created_by text,
  manager_owner_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_whatsapp ON public.campaigns(whatsapp_number);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read campaigns" ON public.campaigns FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public write campaigns" ON public.campaigns FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admins read campaigns" ON public.campaigns FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write campaigns" ON public.campaigns FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Campaign-contact relationship
CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  first_touch boolean NOT NULL DEFAULT false,
  last_touch boolean NOT NULL DEFAULT true,
  fit_score integer,
  intent_level text,
  emotional_engagement integer,
  conversion_probability integer,
  conversion_stage text DEFAULT 'new',
  conversation_intent text,
  ai_reasoning text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_campaign ON public.campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cc_contact ON public.campaign_contacts(contact_id);

ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read campaign_contacts" ON public.campaign_contacts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public write campaign_contacts" ON public.campaign_contacts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admins read campaign_contacts" ON public.campaign_contacts FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write campaign_contacts" ON public.campaign_contacts FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER update_campaign_contacts_updated_at BEFORE UPDATE ON public.campaign_contacts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Contacts: campaign-aware fields
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS first_touch_campaign_id uuid,
  ADD COLUMN IF NOT EXISTS last_touch_campaign_id uuid,
  ADD COLUMN IF NOT EXISTS entry_offer_id uuid,
  ADD COLUMN IF NOT EXISTS campaign_source text,
  ADD COLUMN IF NOT EXISTS acquisition_source text,
  ADD COLUMN IF NOT EXISTS conversation_intent text,
  ADD COLUMN IF NOT EXISTS conversion_stage text;

-- Interactions: campaign linkage
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS campaign_id uuid;
